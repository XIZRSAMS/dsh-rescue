using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace DshRescue
{
    internal static class Program
    {
        private static Process node;
        private static string baseDir;
        private static string url;
        private static NotifyIcon tray;
        private static string outLog;
        private static string errLog;
        private static volatile string token;

        [STAThread]
        private static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            baseDir = FindBaseDir();
            if (baseDir == null) { Fail("找不到 scripts\\entry.mjs。请把启动器放在 dsh-rescue 目录里。"); return; }

            string nodeExe = FindNode(baseDir);
            if (nodeExe == null) { Fail("找不到 node.exe。期望 runtime\\node\\node.exe 或系统 PATH 里的 node。"); return; }

            int port = ChoosePort(3080);
            if (port == 0) { Fail("3080-3095 全部被占用，请先关掉占用者再试。"); return; }

            url = "http://127.0.0.1:" + port + "/";
            string logDir = Path.Combine(baseDir, "runtime", "logs");
            Directory.CreateDirectory(logDir);
            outLog = Path.Combine(logDir, "launcher.out.log");
            errLog = Path.Combine(logDir, "launcher.err.log");

            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = nodeExe;
            psi.Arguments = "\"" + Path.Combine(baseDir, "scripts", "entry.mjs") + "\" --host 127.0.0.1 --port " + port + " --no-open";
            psi.WorkingDirectory = baseDir;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.EnvironmentVariables["DSH_RESCUE_UI"] = "minimal";
            string tmpDir = Path.Combine(baseDir, "runtime", "tmp");
            Directory.CreateDirectory(tmpDir);
            psi.EnvironmentVariables["TMP"] = tmpDir;
            psi.EnvironmentVariables["TEMP"] = tmpDir;

            node = new Process();
            node.StartInfo = psi;
            node.OutputDataReceived += delegate(object s, DataReceivedEventArgs e)
            {
                Append(outLog, e.Data);
                CaptureToken(e.Data);
            };
            node.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e) { Append(errLog, e.Data); };
            node.Start();
            node.BeginOutputReadLine();
            node.BeginErrorReadLine();

            bool ready = WaitReady(url + "dsh-rescue/capabilities.json", 45000);
            if (!ready)
            {
                string tail = Tail(errLog, 12);
                Fail("服务没有在 45 秒内起来。\n\n" + tail + "\n\n日志: " + errLog);
                return;
            }

            SetupTray();
            OpenBrowser();
            Application.Run();
        }

        private static string FindBaseDir()
        {
            string dir = AppDomain.CurrentDomain.BaseDirectory;
            for (int i = 0; i < 4 && dir != null; i++)
            {
                if (File.Exists(Path.Combine(dir, "scripts", "entry.mjs"))) return dir;
                DirectoryInfo parent = Directory.GetParent(dir);
                dir = parent == null ? null : parent.FullName;
            }
            return null;
        }

        private static string FindNode(string root)
        {
            string[] candidates = new string[]
            {
                Path.Combine(root, "runtime", "node", "node.exe"),
                Path.Combine(root, "runtime", "node.exe"),
            };
            for (int i = 0; i < candidates.Length; i++)
            {
                if (File.Exists(candidates[i])) return candidates[i];
            }
            string path = Environment.GetEnvironmentVariable("PATH") ?? "";
            string[] parts = path.Split(';');
            for (int i = 0; i < parts.Length; i++)
            {
                if (parts[i].Trim().Length == 0) continue;
                string candidate = Path.Combine(parts[i].Trim(), "node.exe");
                if (File.Exists(candidate)) return candidate;
            }
            return null;
        }

        private static int ChoosePort(int start)
        {
            for (int port = start; port < start + 16; port++)
            {
                TcpListener listener = null;
                try
                {
                    listener = new TcpListener(IPAddress.Loopback, port);
                    listener.Start();
                    listener.Stop();
                    return port;
                }
                catch
                {
                    if (listener != null) { try { listener.Stop(); } catch { } }
                }
            }
            return 0;
        }

        private static bool WaitReady(string probeUrl, int timeoutMs)
        {
            Stopwatch watch = Stopwatch.StartNew();
            while (watch.ElapsedMilliseconds < timeoutMs)
            {
                if (node != null && node.HasExited) return false;
                try
                {
                    HttpWebRequest request = (HttpWebRequest)WebRequest.Create(probeUrl);
                    request.Timeout = 1500;
                    request.Proxy = null;
                    using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                    {
                        if ((int)response.StatusCode == 200) return true;
                    }
                }
                catch { }
                Thread.Sleep(400);
            }
            return false;
        }

        private static void SetupTray()
        {
            tray = new NotifyIcon();
            tray.Icon = SystemIcons.Application;
            tray.Text = "dsh-rescue · " + url;
            tray.Visible = true;
            tray.DoubleClick += delegate { OpenBrowser(); };

            ContextMenuStrip menu = new ContextMenuStrip();
            menu.Items.Add("打开界面", null, delegate { OpenBrowser(); });
            menu.Items.Add("复制地址", null, delegate { try { Clipboard.SetText(Url()); } catch { } });
            menu.Items.Add("打开日志目录", null, delegate { try { Process.Start(Path.GetDirectoryName(errLog)); } catch { } });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("退出", null, delegate { Shutdown(); });
            tray.ContextMenuStrip = menu;
            tray.ShowBalloonTip(3000, "dsh-rescue 已启动", url + "\n双击托盘图标打开界面", ToolTipIcon.Info);
        }

        private static void OpenBrowser()
        {
            try { Process.Start(Url()); } catch { }
        }

        private static string Url()
        {
            string t = token;
            if (string.IsNullOrEmpty(t)) return url;
            return url + "?token=" + t;
        }

        private static void CaptureToken(string line)
        {
            if (string.IsNullOrEmpty(line) || line.IndexOf("token=", StringComparison.Ordinal) < 0) return;
            const string marker = "token=";
            int start = line.IndexOf(marker, StringComparison.Ordinal) + marker.Length;
            int end = start;
            while (end < line.Length && (char.IsLetterOrDigit(line[end]) || line[end] == '_' || line[end] == '-')) end++;
            if (end - start >= 8) token = line.Substring(start, end - start);
        }

        private static void Shutdown()
        {
            try { if (tray != null) tray.Visible = false; } catch { }
            try
            {
                if (node != null && !node.HasExited)
                {
                    Process.Start(new ProcessStartInfo("taskkill", "/PID " + node.Id + " /T /F") { CreateNoWindow = true, UseShellExecute = false });
                }
            }
            catch { }
            Application.Exit();
        }

        private static void Append(string path, string line)
        {
            if (line == null) return;
            try { File.AppendAllText(path, line + Environment.NewLine, Encoding.UTF8); } catch { }
        }

        private static string Tail(string path, int lines)
        {
            try
            {
                string[] all = File.ReadAllLines(path);
                int start = Math.Max(0, all.Length - lines);
                StringBuilder sb = new StringBuilder();
                for (int i = start; i < all.Length; i++) sb.AppendLine(all[i]);
                return sb.ToString();
            }
            catch { return "(没有日志)"; }
        }

        private static void Fail(string message)
        {
            try
            {
                if (node != null && !node.HasExited) node.Kill();
            }
            catch { }
            MessageBox.Show(message, "dsh-rescue", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Environment.Exit(1);
        }
    }
}
