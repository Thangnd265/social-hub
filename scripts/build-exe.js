'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { publishUpdateToGitHub } = require('./publish-update.js');

const rootDir = path.resolve(__dirname, '..');
const electronDist = path.join(rootDir, 'node_modules', 'electron', 'dist');
const outRoot = path.join(rootDir, 'dist');
const unpackedDir = path.join(outRoot, 'SocialHub-win32-x64');
const zipPath = path.join(outRoot, 'payload.zip');
const singleExePath = path.join(outRoot, 'SocialHub-Portable.exe');
const setupExePath = path.join(outRoot, 'SocialHub-Setup.exe');
const buildStamp = String(Date.now());

console.log('1. Preparing standalone folder dist/SocialHub-win32-x64...');
fs.rmSync(outRoot, { recursive: true, force: true });
fs.mkdirSync(outRoot, { recursive: true });

// Stamp current build number into package.json before copying into resources/app
const pkgPath = path.join(rootDir, 'package.json');
const pkgData = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkgData.build = Number(buildStamp);
fs.writeFileSync(pkgPath, JSON.stringify(pkgData, null, 2) + '\n', 'utf8');

// Copy Electron runtime
fs.cpSync(electronDist, unpackedDir, { recursive: true });

// Remove default_app.asar so Electron boots resources/app directly
const defaultAsar = path.join(unpackedDir, 'resources', 'default_app.asar');
if (fs.existsSync(defaultAsar)) {
  fs.rmSync(defaultAsar, { force: true });
}

// Copy application files into resources/app
const appResourcesDir = path.join(unpackedDir, 'resources', 'app');
fs.mkdirSync(appResourcesDir, { recursive: true });
fs.copyFileSync(path.join(rootDir, 'package.json'), path.join(appResourcesDir, 'package.json'));
fs.cpSync(path.join(rootDir, 'src'), path.join(appResourcesDir, 'src'), { recursive: true });

// Rename electron.exe -> SocialHub.exe
const srcExe = path.join(unpackedDir, 'electron.exe');
const destExe = path.join(unpackedDir, 'SocialHub.exe');
if (fs.existsSync(srcExe)) {
  fs.renameSync(srcExe, destExe);
}

console.log('2. Compressing standalone bundle into payload.zip...');
execFileSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-Command',
    `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory("${unpackedDir}", "${zipPath}", [System.IO.Compression.CompressionLevel]::Fastest, $false)`,
  ],
  { stdio: 'inherit' }
);

const cscPath = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';

// Shared C# helper methods for stopping running SocialHub processes and overwriting locked files cleanly
const sharedZipHelpersCs = `
    private static void StopRunningSocialHub() {
        try {
            ProcessStartInfo tk = new ProcessStartInfo("taskkill.exe", "/F /IM SocialHub.exe /T");
            tk.CreateNoWindow = true;
            tk.UseShellExecute = false;
            Process p = Process.Start(tk);
            if (p != null) p.WaitForExit(3500);
        } catch {}
        try {
            foreach (Process p in Process.GetProcessesByName("SocialHub")) {
                try { p.Kill(); p.WaitForExit(2000); } catch {}
            }
        } catch {}
        System.Threading.Thread.Sleep(350);
    }

    private static void CleanupOldLockedFiles(string dir) {
        if (!Directory.Exists(dir)) return;
        try {
            foreach (string oldFile in Directory.GetFiles(dir, "*.old_*", SearchOption.AllDirectories)) {
                try {
                    File.SetAttributes(oldFile, FileAttributes.Normal);
                    File.Delete(oldFile);
                } catch {}
            }
        } catch {}
    }

    private static void ExtractZipOverwrite(Stream zipStream, string destDir) {
        Directory.CreateDirectory(destDir);
        CleanupOldLockedFiles(destDir);

        using (ZipArchive archive = new ZipArchive(zipStream, ZipArchiveMode.Read)) {
            foreach (ZipArchiveEntry entry in archive.Entries) {
                string relativePath = entry.FullName.Replace('/', Path.DirectorySeparatorChar).Replace('\\\\', Path.DirectorySeparatorChar);
                string fullPath = Path.Combine(destDir, relativePath);

                if (string.IsNullOrEmpty(entry.Name)) {
                    Directory.CreateDirectory(fullPath);
                    continue;
                }

                string parentDir = Path.GetDirectoryName(fullPath);
                if (!string.IsNullOrEmpty(parentDir)) {
                    Directory.CreateDirectory(parentDir);
                }

                if (File.Exists(fullPath)) {
                    try {
                        File.SetAttributes(fullPath, FileAttributes.Normal);
                        File.Delete(fullPath);
                    } catch {
                        // Windows NTFS allows renaming a memory-mapped/locked file (.dll, .exe, icudtl.dat)
                        // even when another process or antivirus still holds an open handle!
                        try {
                            string backupPath = fullPath + ".old_" + Guid.NewGuid().ToString("N");
                            File.Move(fullPath, backupPath);
                        } catch {}
                    }
                }

                using (Stream entryStream = entry.Open())
                using (FileStream outStream = new FileStream(fullPath, FileMode.Create, FileAccess.Write, FileShare.ReadWrite)) {
                    entryStream.CopyTo(outStream);
                }
            }
        }

        CleanupOldLockedFiles(destDir);
    }
`;

console.log('3. Compiling single-file Windows launcher SocialHub-Portable.exe...');
const csPath = path.join(outRoot, 'Launcher.cs');
const csSource = `
using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Windows.Forms;

class Program {
    private const string BUILD_STAMP = "${buildStamp}";
${sharedZipHelpersCs}
    [STAThread]
    static void Main(string[] args) {
        try {
            string baseDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "SocialHub",
                "runtime"
            );
            string stampFile = Path.Combine(baseDir, ".build_stamp");
            string exePath = Path.Combine(baseDir, "SocialHub.exe");

            bool needsExtract = !File.Exists(exePath) || !File.Exists(stampFile) || File.ReadAllText(stampFile).Trim() != BUILD_STAMP;

            if (needsExtract) {
                StopRunningSocialHub();
                using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip")) {
                    if (s == null) {
                        MessageBox.Show("Không tìm thấy gói dữ liệu bên trong file EXE.", "Social Hub", MessageBoxButtons.OK, MessageBoxIcon.Error);
                        return;
                    }
                    ExtractZipOverwrite(s, baseDir);
                }
                File.WriteAllText(stampFile, BUILD_STAMP);
            }

            ProcessStartInfo psi = new ProcessStartInfo(exePath);
            psi.WorkingDirectory = baseDir;
            psi.Arguments = string.Join(" ", args);
            psi.UseShellExecute = false;
            psi.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
            Process.Start(psi);
        } catch (Exception ex) {
            MessageBox.Show("Lỗi khởi chạy Social Hub: " + ex.Message, "Social Hub", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
`;
fs.writeFileSync(csPath, csSource, 'utf8');

execFileSync(
  cscPath,
  [
    '/nologo',
    '/target:winexe',
    '/optimize+',
    `/out:${singleExePath}`,
    `/resource:${zipPath},payload.zip`,
    '/reference:System.IO.Compression.dll',
    '/reference:System.IO.Compression.FileSystem.dll',
    '/reference:System.Windows.Forms.dll',
    csPath,
  ],
  { stdio: 'inherit' }
);
fs.rmSync(csPath, { force: true });

console.log('4. Compiling Windows Setup Installer SocialHub-Setup.exe...');
const setupCsPath = path.join(outRoot, 'Setup.cs');
const setupCsSource = `
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Windows.Forms;
using Microsoft.Win32;

class SetupProgram {
${sharedZipHelpersCs}
    private static string GetInstallDir() {
        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Programs",
            "SocialHub"
        );
    }

    private static void CreateShortcut(string shortcutPath, string targetExe, string workingDir, string description) {
        try {
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null) return;
            dynamic shell = Activator.CreateInstance(shellType);
            dynamic shortcut = shell.CreateShortcut(shortcutPath);
            shortcut.TargetPath = targetExe;
            shortcut.WorkingDirectory = workingDir;
            shortcut.IconLocation = targetExe + ",0";
            shortcut.Description = description;
            shortcut.Save();
        } catch {}
    }

    private static void RegisterUninstaller(string installDir, string exePath, string uninstallerPath) {
        try {
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\SocialHub")) {
                if (key != null) {
                    key.SetValue("DisplayName", "Social Hub");
                    key.SetValue("DisplayVersion", "1.3.0");
                    key.SetValue("Publisher", "Social Hub Desktop");
                    key.SetValue("DisplayIcon", exePath);
                    key.SetValue("InstallLocation", installDir);
                    key.SetValue("UninstallString", "\\"" + uninstallerPath + "\\" --uninstall");
                    key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                    key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                }
            }
        } catch {}
    }

    private static void SetAutoStartRegistry(bool enable, string exePath) {
        try {
            using (RegistryKey runKey = Registry.CurrentUser.OpenSubKey(@"Software\\Microsoft\\Windows\\CurrentVersion\\Run", true)) {
                if (runKey != null) {
                    if (enable) {
                        runKey.SetValue("SocialHub", "\\"" + exePath + "\\"");
                    } else {
                        runKey.DeleteValue("SocialHub", false);
                    }
                }
            }
        } catch {}
    }

    public static void PerformUninstall(bool silent) {
        try {
            StopRunningSocialHub();
            SetAutoStartRegistry(false, "");
            try {
                Registry.CurrentUser.DeleteSubKeyTree(@"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\SocialHub", false);
            } catch {}

            string desktopLnk = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Social Hub.lnk");
            string startMenuLnk = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs", "Social Hub.lnk");
            if (File.Exists(desktopLnk)) try { File.Delete(desktopLnk); } catch {}
            if (File.Exists(startMenuLnk)) try { File.Delete(startMenuLnk); } catch {}

            if (!silent) {
                MessageBox.Show("Đã gỡ cài đặt Social Hub khỏi Windows thành công.", "Gỡ cài đặt Social Hub", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
        } catch (Exception ex) {
            if (!silent) {
                MessageBox.Show("Lỗi khi gỡ cài đặt: " + ex.Message, "Social Hub", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }

    public static void PerformInstall(bool createDesktop, bool createStartMenu, bool autoStart, bool launchAfter) {
        string installDir = GetInstallDir();
        string exePath = Path.Combine(installDir, "SocialHub.exe");
        string uninstallerPath = Path.Combine(installDir, "Uninstall-SocialHub.exe");

        StopRunningSocialHub();

        using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip")) {
            if (s == null) {
                throw new Exception("Không tìm thấy gói dữ liệu cài đặt payload.zip.");
            }
            ExtractZipOverwrite(s, installDir);
        }

        try {
            string currentInstaller = Assembly.GetExecutingAssembly().Location;
            if (File.Exists(currentInstaller)) {
                if (File.Exists(uninstallerPath)) {
                    try { File.Delete(uninstallerPath); } catch {
                        try { File.Move(uninstallerPath, uninstallerPath + ".old_" + Guid.NewGuid().ToString("N")); } catch {}
                    }
                }
                File.Copy(currentInstaller, uninstallerPath, true);
            }
        } catch {}

        if (createDesktop) {
            string desktopLnk = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Social Hub.lnk");
            CreateShortcut(desktopLnk, exePath, installDir, "Social Hub — Quản lý đa tài khoản mạng xã hội & tin nhắn");
        }

        if (createStartMenu) {
            string startMenuDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs");
            Directory.CreateDirectory(startMenuDir);
            string startMenuLnk = Path.Combine(startMenuDir, "Social Hub.lnk");
            CreateShortcut(startMenuLnk, exePath, installDir, "Social Hub — Quản lý đa tài khoản mạng xã hội & tin nhắn");
        }

        RegisterUninstaller(installDir, exePath, uninstallerPath);
        SetAutoStartRegistry(autoStart, exePath);

        if (launchAfter && File.Exists(exePath)) {
            ProcessStartInfo psi = new ProcessStartInfo(exePath);
            psi.WorkingDirectory = installDir;
            psi.UseShellExecute = false;
            psi.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
            Process.Start(psi);
        }
    }

    [STAThread]
    static void Main(string[] args) {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        bool isSilent = false;
        bool isUninstall = false;
        bool noLaunch = false;
        foreach (string a in args) {
            if (a == "--silent" || a == "/S") isSilent = true;
            if (a == "--uninstall") isUninstall = true;
            if (a == "--no-launch") noLaunch = true;
        }

        if (isUninstall) {
            PerformUninstall(isSilent);
            return;
        }

        if (isSilent) {
            try {
                PerformInstall(true, true, false, !noLaunch);
            } catch (Exception ex) {
                Console.Error.WriteLine("Setup error: " + ex.Message);
                Environment.ExitCode = 1;
            }
            return;
        }

        Form form = new Form();
        form.Text = "Cài đặt / Cập nhật Social Hub cho Windows";
        form.ClientSize = new Size(540, 310);
        form.FormBorderStyle = FormBorderStyle.FixedDialog;
        form.MaximizeBox = false;
        form.StartPosition = FormStartPosition.CenterScreen;
        form.BackColor = Color.FromArgb(24, 27, 32);
        form.ForeColor = Color.White;
        form.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);

        Label title = new Label();
        title.Text = "Trình cài đặt & Cập nhật Social Hub";
        title.Font = new Font("Segoe UI", 12f, FontStyle.Bold);
        title.AutoSize = true;
        title.Location = new Point(24, 20);

        Label sub = new Label();
        sub.Text = "Tích hợp Khay hệ thống (System Tray), Thông báo, Start Menu & Phím tắt Alt+S";
        sub.ForeColor = Color.FromArgb(165, 173, 186);
        sub.AutoSize = true;
        sub.Location = new Point(24, 48);

        CheckBox cbDesktop = new CheckBox();
        cbDesktop.Text = "Tạo biểu tượng Social Hub ngoài màn hình Desktop";
        cbDesktop.Checked = true;
        cbDesktop.AutoSize = true;
        cbDesktop.Location = new Point(28, 90);

        CheckBox cbStartMenu = new CheckBox();
        cbStartMenu.Text = "Tạo biểu tượng trong Start Menu & Windows Installed Apps";
        cbStartMenu.Checked = true;
        cbStartMenu.AutoSize = true;
        cbStartMenu.Location = new Point(28, 122);

        CheckBox cbAutoStart = new CheckBox();
        cbAutoStart.Text = "Khởi động cùng Windows (chạy ngầm nhận tin nhắn)";
        cbAutoStart.Checked = false;
        cbAutoStart.AutoSize = true;
        cbAutoStart.Location = new Point(28, 154);

        CheckBox cbLaunch = new CheckBox();
        cbLaunch.Text = "Mở Social Hub ngay sau khi cài đặt hoàn tất";
        cbLaunch.Checked = true;
        cbLaunch.AutoSize = true;
        cbLaunch.Location = new Point(28, 186);

        ProgressBar progress = new ProgressBar();
        progress.Location = new Point(24, 224);
        progress.Size = new Size(492, 18);
        progress.Style = ProgressBarStyle.Continuous;
        progress.Visible = false;

        Button btnInstall = new Button();
        btnInstall.Text = "Cài đặt / Cập nhật";
        btnInstall.Size = new Size(160, 36);
        btnInstall.Location = new Point(244, 254);
        btnInstall.BackColor = Color.FromArgb(0, 104, 255);
        btnInstall.ForeColor = Color.White;
        btnInstall.FlatStyle = FlatStyle.Flat;
        btnInstall.FlatAppearance.BorderSize = 0;

        Button btnCancel = new Button();
        btnCancel.Text = "Đóng";
        btnCancel.Size = new Size(100, 36);
        btnCancel.Location = new Point(416, 254);
        btnCancel.BackColor = Color.FromArgb(45, 50, 59);
        btnCancel.ForeColor = Color.White;
        btnCancel.FlatStyle = FlatStyle.Flat;
        btnCancel.FlatAppearance.BorderSize = 0;
        btnCancel.Click += (s, e) => form.Close();

        btnInstall.Click += (s, e) => {
            btnInstall.Enabled = false;
            btnCancel.Enabled = false;
            progress.Visible = true;
            progress.Value = 35;
            Application.DoEvents();
            try {
                PerformInstall(cbDesktop.Checked, cbStartMenu.Checked, cbAutoStart.Checked, cbLaunch.Checked);
                progress.Value = 100;
                Application.DoEvents();
                MessageBox.Show(
                    "Đã cài đặt / cập nhật Social Hub thành công!\\n\\n• Thư mục cài đặt: " + GetInstallDir() + "\\n• Phím tắt gọi nhanh toàn cục: Alt + S\\n• Đóng cửa sổ (✕) sẽ thu xuống góc phải khay hệ thống (System Tray).",
                    "Cài đặt hoàn tất",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information
                );
                form.Close();
            } catch (Exception ex) {
                MessageBox.Show("Lỗi cài đặt: " + ex.Message, "Social Hub Setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
                btnInstall.Enabled = true;
                btnCancel.Enabled = true;
            }
        };

        form.Controls.Add(title);
        form.Controls.Add(sub);
        form.Controls.Add(cbDesktop);
        form.Controls.Add(cbStartMenu);
        form.Controls.Add(cbAutoStart);
        form.Controls.Add(cbLaunch);
        form.Controls.Add(progress);
        form.Controls.Add(btnInstall);
        form.Controls.Add(btnCancel);

        Application.Run(form);
    }
}
`;
fs.writeFileSync(setupCsPath, setupCsSource, 'utf8');

execFileSync(
  cscPath,
  [
    '/nologo',
    '/target:winexe',
    '/optimize+',
    `/out:${setupExePath}`,
    `/resource:${zipPath},payload.zip`,
    '/reference:System.Drawing.dll',
    '/reference:System.IO.Compression.dll',
    '/reference:System.IO.Compression.FileSystem.dll',
    '/reference:System.Windows.Forms.dll',
    '/reference:Microsoft.CSharp.dll',
    setupCsPath,
  ],
  { stdio: 'inherit' }
);

fs.rmSync(setupCsPath, { force: true });
fs.rmSync(zipPath, { force: true });

console.log('DONE! Created both:');
console.log('  - Portable EXE:', singleExePath);
console.log('  - Windows Installer EXE:', setupExePath);

console.log('5. Publishing OTA update (version.json + app-update.zip) to GitHub...');
publishUpdateToGitHub(buildStamp).catch((err) => {
  console.warn('GitHub OTA publish warning:', err.message);
});
