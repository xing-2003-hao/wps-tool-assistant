/* ============================================================
 * WPS 工具助手 · 管理台启动器
 * 双击 = 打开卡密/用户管理后台（独立无地址栏窗口）
 *   1. 读取 exe 旁边的 admin-url.txt（可选，第一行写远程地址，如 https://api.xxx.com/admin）
 *      不填则默认本机 http://127.0.0.1:3910/admin
 *   2. 本机地址但服务未起 → 自动找 node + server.js 后台拉起
 *   3. 用 Edge/Chrome 的 --app 模式打开（无地址栏，像个桌面软件）
 * 注意：源码保持纯 ASCII，中文全部 \u 转义（csc 代码页问题）
 * ============================================================ */
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Windows.Forms;

static class AdminLauncher
{
    const string DEFAULT_URL = "http://127.0.0.1:3910/admin";
    const int PORT = 3910;

    [STAThread]
    static void Main()
    {
        Application.EnableVisualStyles();
        string exeDir = Path.GetDirectoryName(Application.ExecutablePath);
        string url = ReadUrl(exeDir);
        Log("start exeDir=" + exeDir + " url=" + url);
        bool isLocal = url.IndexOf("127.0.0.1") >= 0 || url.IndexOf("localhost") >= 0;

        if (isLocal && !Probe(3000))
        {
            Log("local probe failed, starting server");
            string serverJs = FindServer(exeDir);
            if (serverJs == null)
            {
                Log("server.js not found");
                Msg("\u672a\u627e\u5230 server.js\u3002\n\u8bf7\u628a\u672c\u7a0b\u5e8f\u653e\u5728\u9879\u76ee\u6839\u76ee\u5f55\u6216 dist \u76ee\u5f55\u4e0b\uff0c\u6216\u5728 admin-url.txt \u91cc\u586b\u5199\u8fdc\u7a0b\u7ba1\u7406\u5730\u5740\u3002", true);
                return;
            }
            string node = FindNode();
            if (node == null)
            {
                Log("node not found");
                Msg("\u672a\u627e\u5230 Node.js\u3002\n\u8bf7\u5148\u5b89\u88c5 Node.js\uff0c\u6216\u624b\u52a8\u8fd0\u884c\uff1anode server/server.js", true);
                return;
            }
            Log("node=" + node + " server=" + serverJs);
            if (!StartServer(node, serverJs))
            {
                Log("server start timeout");
                Msg("\u672c\u5730\u670d\u52a1\u542f\u52a8\u5931\u8d25\uff0c\u8bf7\u624b\u52a8\u5728 server \u76ee\u5f55\u6267\u884c node server.js \u67e5\u770b\u62a5\u9519\u3002", true);
                return;
            }
            Log("server ready");
        }
        else if (!isLocal && !Probe(3000))
        {
            Log("remote unreachable");
            Msg("\u8fde\u4e0d\u4e0a\u7ba1\u7406\u5730\u5740\uff1a\n" + url, true);
            return;
        }

        Log("opening window");
        OpenAppWindow(url);
        Log("done");
    }

    static void Log(string s)
    {
        try
        {
            File.AppendAllText(Path.Combine(Path.GetTempPath(), "wta-admin.log"),
                DateTime.Now.ToString("HH:mm:ss") + " " + s + "\r\n", Encoding.UTF8);
        }
        catch { }
    }

    static string ReadUrl(string exeDir)
    {
        try
        {
            string f = Path.Combine(exeDir, "admin-url.txt");
            if (File.Exists(f))
            {
                foreach (string line in File.ReadAllLines(f, Encoding.UTF8))
                {
                    string s = line.Trim();
                    if (s.Length > 0 && !s.StartsWith("#")) return s;
                }
            }
        }
        catch { }
        return DEFAULT_URL;
    }

    static bool Probe(int timeoutMs)
    {
        try
        {
            HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + PORT + "/admin");
            req.Timeout = timeoutMs;
            req.Proxy = null;
            using (HttpWebResponse r = (HttpWebResponse)req.GetResponse())
                return (int)r.StatusCode == 200;
        }
        catch { return false; }
    }

    /* 在 exe 附近找 server/server.js */
    static string FindServer(string exeDir)
    {
        string[] cands = {
            Path.Combine(exeDir, "server", "server.js"),
            Path.Combine(exeDir, "..", "server", "server.js"),
            Path.Combine(exeDir, "..", "..", "server", "server.js")
        };
        foreach (string c in cands)
        {
            try { if (File.Exists(Path.GetFullPath(c))) return Path.GetFullPath(c); } catch { }
        }
        return null;
    }

    /* 找 node.exe：PATH → 常见安装目录 */
    static string FindNode()
    {
        string pathVar = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (string d in pathVar.Split(';'))
        {
            if (d.Trim().Length == 0) continue;
            try
            {
                string p = Path.Combine(d.Trim(), "node.exe");
                if (File.Exists(p)) return p;
            }
            catch { }
        }
        string[] cands = {
            @"C:\Program Files\nodejs\node.exe",
            @"C:\Program Files (x86)\nodejs\node.exe",
            @"C:\app\nodejs\node.exe",
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\nodejs\node.exe")
        };
        foreach (string c in cands) if (File.Exists(c)) return c;
        return null;
    }

    /* 后台拉起服务端并等待就绪 */
    static bool StartServer(string node, string serverJs)
    {
        Form splash = new Form();
        splash.FormBorderStyle = FormBorderStyle.None;
        splash.StartPosition = FormStartPosition.CenterScreen;
        splash.Size = new Size(300, 90);
        splash.BackColor = Color.White;
        splash.TopMost = true;
        Label lb = new Label();
        lb.Text = "\u6b63\u5728\u542f\u52a8\u7ba1\u7406\u670d\u52a1\u2026";
        lb.Font = new Font("Microsoft YaHei", 10f);
        lb.AutoSize = false;
        lb.Dock = DockStyle.Fill;
        lb.TextAlign = ContentAlignment.MiddleCenter;
        splash.Controls.Add(lb);
        splash.Show();
        Application.DoEvents();

        try
        {
            ProcessStartInfo psi = new ProcessStartInfo(node, "server.js");
            psi.WorkingDirectory = Path.GetDirectoryName(serverJs);
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            Process.Start(psi);
        }
        catch (Exception ex)
        {
            splash.Close();
            Msg("\u542f\u52a8\u670d\u52a1\u5668\u5931\u8d25\uff1a" + ex.Message, true);
            return false;
        }

        for (int i = 0; i < 30; i++)   // 最多等 15 秒
        {
            Thread.Sleep(500);
            Application.DoEvents();
            if (Probe(800)) { splash.Close(); return true; }
        }
        splash.Close();
        return false;
    }

    /* 用 Edge/Chrome 的 app 模式打开（无地址栏）；找不到就用默认浏览器 */
    static void OpenAppWindow(string url)
    {
        // 每次打开带时间戳，绕开浏览器缓存（改版后不用手动 Ctrl+F5）
        string bust = url + (url.IndexOf('?') >= 0 ? "&" : "?") + "v=" + DateTime.Now.Ticks;
        string[] brands = {
            @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            @"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
            @"C:\Program Files\Google\Chrome\Application\chrome.exe",
            @"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Google\Chrome\Application\chrome.exe")
        };
        foreach (string b in brands)
        {
            if (!File.Exists(b)) continue;
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(b,
                    "--app=" + bust + " --window-size=1240,860 --window-position=80,60");
                psi.UseShellExecute = false;
                Process p = Process.Start(psi);
                Log("browser=" + b + " pid=" + (p == null ? 0 : p.Id));
                return;
            }
            catch (Exception ex) { Log("browser fail " + b + ": " + ex.Message); }
        }
        try { Process.Start(bust); Log("fallback default browser"); }
        catch (Exception ex) { Log("fallback fail: " + ex.Message); Msg("\u65e0\u6cd5\u6253\u5f00\u7ba1\u7406\u53f0\uff1a" + ex.Message, true); }
    }

    static void Msg(string text, bool error)
    {
        MessageBox.Show(text, "WPS \u5de5\u5177\u52a9\u624b \u00b7 \u7ba1\u7406\u53f0",
            MessageBoxButtons.OK, error ? MessageBoxIcon.Error : MessageBoxIcon.Information);
    }
}
