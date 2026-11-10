/* ============================================================
 * WPS 工具助手 · 管理台启动器
 * 双击 = 打开卡密/用户管理后台（独立无地址栏窗口）
 *   1. 读取 exe 旁边的 admin-url.txt（可选，第一行写远程地址，如 https://api.xxx.com/admin）
 *      不填则默认本机 http://127.0.0.1:3910/admin
 *   2. 本机地址但服务未起 → 自动找 node + server.js 后台拉起
 *   3. 用 Edge/Chrome 的 --app 模式打开（无地址栏，像个桌面软件）
 *   调试：exe --probe-only  = 只检测地址连通性并写日志，不打开浏览器
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
    /* 默认 = 线上管理台；想连本机开发环境，在 exe 旁放 admin-url.txt 写 http://127.0.0.1:3910/admin */
    const string DEFAULT_URL = "https://wps-tool-assistant.app.workbuddy.host/admin?sharecode=YT3HRQMGYO";
    const int PORT = 3910;

    [STAThread]
    static void Main()
    {
        Application.EnableVisualStyles();
        string exeDir = Path.GetDirectoryName(Application.ExecutablePath);
        string url = ReadUrl(exeDir);
        Log("start exeDir=" + exeDir + " url=" + url);
        bool isLocal = url.IndexOf("127.0.0.1") >= 0 || url.IndexOf("localhost") >= 0;

        if (isLocal && !Probe(url, 3000))
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
            if (!StartServer(node, serverJs, url))
            {
                Log("server start timeout");
                Msg("\u672c\u5730\u670d\u52a1\u542f\u52a8\u5931\u8d25\uff0c\u8bf7\u624b\u52a8\u5728 server \u76ee\u5f55\u6267\u884c node server.js \u67e5\u770b\u62a5\u9519\u3002", true);
                return;
            }
            Log("server ready");
        }
        else if (!isLocal)
        {
            bool reachable = Probe(url, 8000);
            Log("remote probe " + (reachable ? "OK" : "FAILED"));
            if (IsProbeOnly()) return;
            if (!reachable)
            {
                /* 网络/代理/防火墙都可能拦，给用户一个「仍然打开」的出口，
                   别一刀切成死路（浏览器里也许能打开） */
                DialogResult r = MessageBox.Show(
                    "\u68c0\u6d4b\u4e0d\u5230\u7ba1\u7406\u5730\u5740\uff08\u53ef\u80fd\u662f\u7f51\u7edc\u3001\u4ee3\u7406\u6216\u9632\u706b\u5899\u95ee\u9898\uff09\uff1a\n" + url +
                    "\n\n\u662f\u5426\u4ecd\u7136\u7528\u6d4f\u89c8\u5668\u6253\u5f00\u8bd5\u8bd5\uff1f",
                    "WPS \u5de5\u5177\u52a9\u624b \u00b7 \u7ba1\u7406\u53f0",
                    MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
                if (r != DialogResult.Yes) return;
                Log("user chose to open anyway");
            }
        }
        else if (IsProbeOnly()) { return; }

        Log("opening window");
        if (IsProbeOnly()) { Log("probe-only done"); return; }
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

    /* 探测地址是否可达：本机看端口能否连上，远程发一次 GET，有任何 HTTP 响应即算通
       注意：早先版本这里写死探测 127.0.0.1:3910，导致配了线上地址也报「连不上」 */
    static bool Probe(string url, int timeoutMs)
    {
        for (int attempt = 0; attempt < 2; attempt++)
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
                req.Timeout = timeoutMs;
                req.ReadWriteTimeout = timeoutMs;
                req.Method = "GET";
                req.UserAgent = "WTA-Admin-Launcher/1.1";
                req.AllowAutoRedirect = true;
                req.KeepAlive = false;
                using (HttpWebResponse r = (HttpWebResponse)req.GetResponse())
                {
                    if ((int)r.StatusCode < 500) return true;
                }
            }
            catch (WebException wex)
            {
                /* 401/403/404 之类也算网络是通的；只有连不上才继续重试 */
                if (wex.Response is HttpWebResponse) return true;
            }
            catch { }
            Thread.Sleep(400);
        }
        return false;
    }

    static bool IsProbeOnly()
    {
        foreach (string a in Environment.GetCommandLineArgs())
            if (a == "--probe-only") return true;
        return false;
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
    static bool StartServer(string node, string serverJs, string url)
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
            if (Probe(url, 800)) { splash.Close(); return true; }
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
