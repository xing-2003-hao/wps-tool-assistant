// ============================================================
// WPS Tool Assistant - launcher (tray + embedded static server)
// Why a server: WPS loads js add-ins from an HTTP url (publish.xml
// <jspluginonline>), same mechanism as `wpsjs debug`. So this exe
// serves the embedded add-in files from 127.0.0.1:<port> and
// registers that url, then keeps running in the system tray.
// Build: node scripts/build-exe.js   (resources named WTA__<host>__<file>)
// Test:  WPS工具助手-安装启动.exe /silent   (no dialogs, no WPS launch)
// NOTE: keep this file ASCII-only (Chinese text uses \uXXXX)
// ============================================================
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace WtaLauncher
{
    class Program
    {
        const string AddinName = "wps-tool-assistant";
        static TcpListener listener;
        static int port = 3889;
        static NotifyIcon tray;
        static bool silent = false;
        static bool panelOnly = false;   // /panel：桌面快捷方式用，只开独立面板
        static string publishXmlPath;

        [DllImport("user32.dll")]
        static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")]
        static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
        [DllImport("user32.dll")]
        static extern bool IsIconic(IntPtr hWnd);
        [DllImport("user32.dll")]
        static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
        [DllImport("user32.dll")]
        static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
        [DllImport("user32.dll")]
        static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
        [DllImport("user32.dll")]
        static extern bool UnregisterHotKey(IntPtr hWnd, int id);

        const int HOTKEY_ID = 0xA17;
        const uint MOD_ALT = 0x1;
        const uint MOD_CONTROL = 0x2;
        const uint VK_W = 0x57;

        // 无窗体的托盘程序收不到 WM_HOTKEY，用消息过滤器截
        class HotKeyFilter : IMessageFilter
        {
            public bool PreFilterMessage(ref Message m)
            {
                if (m.Msg == 0x0312 && m.WParam.ToInt32() == HOTKEY_ID)
                {
                    OpenPanelStandalone();
                    return true;
                }
                return false;
            }
        }

        [STAThread]
        static void Main(string[] args)
        {
            silent = Array.IndexOf(args, "/silent") >= 0;
            panelOnly = Array.IndexOf(args, "/panel") >= 0;

            // 云端模型多为 TLS 1.2+，.NET Framework 4 默认只到 TLS 1.0
            try { ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072 | (SecurityProtocolType)768 | (SecurityProtocolType)192; } catch { }
            try { ServicePointManager.Expect100Continue = false; } catch { }

            bool created;
            using (Mutex mutex = new Mutex(true, "WTA_LAUNCHER_MUTEX", out created))
            {
                if (!created)
                {
                    // 已在运行：不启第二个副本。/panel 只负责把独立面板拉起来
                    if (panelOnly)
                    {
                        int p = ReadPortFile();
                        if (p > 0) { port = p; OpenPanelStandalone(); Log("PANEL via shortcut"); }
                    }
                    else RunSecondary();
                    return;
                }

                try
                {
                    StartServer();
                    WritePortFile(port);
                    publishXmlPath = Path.Combine(JsAddonsDir(), "publish.xml");
                    WritePublishXml(publishXmlPath, port);
                    Log("START port=" + port + " wpsExe=" + (FindWpsExe() ?? "not-found"));

                    SetupTray();
                    CreatePanelShortcut();

                    // 桌面快捷方式冷启动：只开面板，不拉 WPS
                    if (panelOnly) { OpenPanelStandalone(); Log("PANEL cold start"); }
                    else if (!silent)
                    {
                        bool wpsWasRunning = WpsRunning();
                        string wpsExe = wpsWasRunning ? null : FindWpsExe();
                        if (wpsExe != null) { try { Process.Start(wpsExe); } catch { } }
                        ShowControlWindow(false);   // 弹窗控制台：状态 + 常用动作
                    }

                    Application.Run(); // message loop, exits via tray menu
                }
                catch (Exception ex)
                {
                    if (!silent) Msg("\u542f\u52a8\u5931\u8d25\uff1a" + ex.Message, true);
                    else Console.WriteLine("START FAILED: " + ex.Message);
                }
                finally
                {
                    if (publishXmlPath != null) RemovePublishEntries(publishXmlPath);
                    DeletePortFile();
                    try { if (listener != null) listener.Stop(); } catch { }
                }
            }
        }

        static void Msg(string text, bool error)
        {
            MessageBox.Show(text, "\u5de5\u5177\u52a9\u624b",
                MessageBoxButtons.OK, error ? MessageBoxIcon.Error : MessageBoxIcon.Information);
        }

        /* ================= embedded static server ================= */

        static void StartServer()
        {
            for (int p = 3889; p < 3910; p++)
            {
                try
                {
                    TcpListener l = new TcpListener(IPAddress.Loopback, p);
                    l.Start();
                    listener = l;
                    port = p;
                    break;
                }
                catch { }
            }
            if (listener == null) throw new Exception("\u672c\u5730\u7aef\u53e3 3889-3909 \u5168\u90e8\u88ab\u5360\u7528");
            Thread t = new Thread(AcceptLoop);
            t.IsBackground = true;
            t.Start();
        }

        static void AcceptLoop()
        {
            while (true)
            {
                try
                {
                    TcpClient c = listener.AcceptTcpClient();
                    ThreadPool.QueueUserWorkItem(new WaitCallback(HandleClient), c);
                }
                catch { return; }
            }
        }

        static void HandleClient(object state)
        {
            TcpClient c = (TcpClient)state;
            try
            {
                using (c)
                using (NetworkStream ns = c.GetStream())
                {
                    c.ReceiveTimeout = 600000;
                    byte[] raw = ReadRequest(ns);
                    int he = IndexOfSeq(raw, new byte[] { 13, 10, 13, 10 });
                    if (he < 0) return;

                    string head = Encoding.ASCII.GetString(raw, 0, he);
                    string[] lines = head.Split(new string[] { "\r\n" }, StringSplitOptions.None);
                    Match m = Regex.Match(lines.Length > 0 ? lines[0] : "", @"^(\S+)\s+(\S+)");
                    string method = m.Success ? m.Groups[1].Value : "GET";
                    string pathAndQuery = m.Success ? m.Groups[2].Value : "/";
                    string path = pathAndQuery.Split('?')[0].Split('#')[0];

                    byte[] body = new byte[raw.Length - he - 4];
                    Array.Copy(raw, he + 4, body, 0, body.Length);

                    int contentLength = 0;
                    string contentType = "application/json";
                    string auth = null;
                    for (int i = 1; i < lines.Length; i++)
                    {
                        int cp = lines[i].IndexOf(':');
                        if (cp <= 0) continue;
                        string hn = lines[i].Substring(0, cp).Trim().ToLower();
                        string hv = lines[i].Substring(cp + 1).Trim();
                        if (hn == "content-length") int.TryParse(hv, out contentLength);
                        else if (hn == "content-type") contentType = hv;
                        else if (hn == "authorization") auth = hv;
                    }
                    if (contentLength > body.Length) body = ReadMore(ns, body, contentLength);

                    // 外部链接：用系统默认浏览器打开
                    if (path == "/open")
                    {
                        string u = GetQuery(pathAndQuery, "url");
                        if (string.IsNullOrEmpty(u) || !(u.StartsWith("http://") || u.StartsWith("https://")))
                        {
                            Send(ns, "400 Bad Request", "application/json", Encoding.UTF8.GetBytes("{\"error\":\"bad url\"}"));
                            return;
                        }
                        try { Process.Start(u); } catch { }
                        Log("OPEN " + u);
                        Send(ns, "200 OK", "application/json", Encoding.UTF8.GetBytes("{\"ok\":true}"));
                        return;
                    }

                    // 原生文件选择：/pick?mode=file|dir&multi=1&filter=图片|*.jpg;*.png
                    if (path == "/pick")
                    {
                        if (method == "OPTIONS") { SendCors(ns); return; }
                        DoPick(ns, pathAndQuery);
                        return;
                    }

                    // 读取本地文件内容（供选完文件后送进 webview 处理）
                    if (path == "/file")
                    {
                        if (method == "OPTIONS") { SendCors(ns); return; }
                        string fp = GetQuery(pathAndQuery, "path");
                        if (string.IsNullOrEmpty(fp) || !File.Exists(fp)) { Send(ns, "404 Not Found", "text/plain", Encoding.UTF8.GetBytes("not found")); return; }
                        byte[] fb;
                        try { fb = File.ReadAllBytes(fp); } catch { Send(ns, "500 Error", "text/plain", Encoding.UTF8.GetBytes("read failed")); return; }
                        Send(ns, "200 OK", MimeOf(fp), fb);
                        return;
                    }

                    // 读系统剪贴板文本：在 PDF 里选中复制后，面板 / 热键直接拿来用
                    // （WPS webview 里读剪贴板受限，所以放到服务端读）
                    if (path == "/clipboard")
                    {
                        if (method == "OPTIONS") { SendCors(ns); return; }
                        string cbText = ReadClipboardText();
                        Log("CLIPBOARD " + cbText.Length + "B");
                        Send(ns, "200 OK", "application/json",
                            Encoding.UTF8.GetBytes("{\"ok\":true,\"text\":\"" + JsonEscape(cbText) + "\"}"));
                        return;
                    }

                    // 健康检查：面板启动时探一下服务是否还活着
                    if (path == "/ping")
                    {
                        Send(ns, "200 OK", "application/json", Encoding.UTF8.GetBytes("{\"ok\":true,\"app\":\"wta\",\"port\":3889}"));
                        return;
                    }

                    // 只算目标路径，不建文件：给「Word 转 PDF」这类由 WPS 自己写盘的场景用
                    if (path == "/target")
                    {
                        if (method == "OPTIONS") { SendCors(ns); return; }
                        string tn = GetQuery(pathAndQuery, "name");
                        string tfull = TargetPath(tn);
                        if (tfull == null)
                        {
                            Send(ns, "500 Error", "application/json", Encoding.UTF8.GetBytes("{\"ok\":false,\"error\":\"cannot resolve output dir\"}"));
                            return;
                        }
                        Log("TARGET " + tfull);
                        Send(ns, "200 OK", "application/json", Encoding.UTF8.GetBytes("{\"ok\":true,\"path\":\"" + JsonEscape(tfull) + "\"}"));
                        return;
                    }

                    // 保存产物：POST /save?name=xxx.pdf（body 为二进制），落到「下载\WPS工具助手\」
                    if (path == "/save")
                    {
                        if (method == "OPTIONS") { SendCors(ns); return; }
                        string name = GetQuery(pathAndQuery, "name");
                        string saved = DoSave(name, body);
                        if (saved == null)
                        {
                            Send(ns, "400 Bad Request", "application/json",
                                Encoding.UTF8.GetBytes("{\"ok\":false,\"error\":\"save failed\"}"));
                            return;
                        }
                        Log("SAVE " + saved + " (" + body.Length + "B)");
                        string json = "{\"ok\":true,\"path\":\"" + JsonEscape(saved) + "\",\"size\":" + body.Length + "}";
                        Send(ns, "200 OK", "application/json", Encoding.UTF8.GetBytes(json));
                        return;
                    }

                    // 在资源管理器中定位文件
                    if (path == "/reveal")
                    {
                        if (method == "OPTIONS") { SendCors(ns); return; }
                        string p = GetQuery(pathAndQuery, "path");
                        try { if (!string.IsNullOrEmpty(p) && File.Exists(p)) Process.Start("explorer.exe", "/select,\"" + p + "\""); } catch { }
                        Send(ns, "200 OK", "application/json", Encoding.UTF8.GetBytes("{\"ok\":true}"));
                        return;
                    }

                    // 代理：/proxy?target=<编码后的完整地址>，用于绕过 webview 跨域
                    if (path == "/proxy")
                    {
                        if (method == "OPTIONS")
                        {
                            string pre = "HTTP/1.1 204 No Content\r\n"
                                + "Access-Control-Allow-Origin: *\r\n"
                                + "Access-Control-Allow-Headers: *\r\n"
                                + "Access-Control-Allow-Methods: POST, GET, OPTIONS\r\n"
                                + "Content-Length: 0\r\n"
                                + "Connection: close\r\n\r\n";
                            byte[] pb = Encoding.ASCII.GetBytes(pre);
                            ns.Write(pb, 0, pb.Length);
                            return;
                        }
                        DoProxy(ns, method, pathAndQuery, contentType, auth, body);
                        return;
                    }

                    if (path == "/" || path == "") path = "/wps/panel.html";

                    string resName = "WTA__" + path.TrimStart('/').Replace("/", "__");
                    Assembly asm = Assembly.GetExecutingAssembly();
                    Stream s = null;
                    try { s = asm.GetManifestResourceStream(resName); } catch { }
                    if (s == null)
                    {
                        Log("404 " + path);
                        Send(ns, "404 Not Found", "text/plain", Encoding.UTF8.GetBytes("Not Found: " + path));
                        return;
                    }
                    byte[] outBody;
                    using (s)
                    using (MemoryStream ms = new MemoryStream())
                    {
                        byte[] tmp = new byte[8192];
                        int n;
                        while ((n = s.Read(tmp, 0, tmp.Length)) > 0) ms.Write(tmp, 0, n);
                        outBody = ms.ToArray();
                    }
                    Send(ns, "200 OK", MimeOf(path), outBody);
                    Log("200 " + path);
                }
            }
            catch { }
        }

        static byte[] ReadRequest(NetworkStream ns)
        {
            MemoryStream ms = new MemoryStream();
            byte[] buf = new byte[8192];
            byte[] sep = new byte[] { 13, 10, 13, 10 };
            while (ms.Length < 64 * 1024 * 1024)
            {
                int n = ns.Read(buf, 0, buf.Length);
                if (n <= 0) break;
                ms.Write(buf, 0, n);
                if (IndexOfSeq(ms.ToArray(), sep) >= 0) break;
            }
            return ms.ToArray();
        }

        static byte[] ReadMore(NetworkStream ns, byte[] have, int total)
        {
            if (have.Length >= total) return have;
            byte[] res = new byte[total];
            Array.Copy(have, res, have.Length);
            int off = have.Length;
            while (off < total)
            {
                int n = ns.Read(res, off, total - off);
                if (n <= 0) break;
                off += n;
            }
            return res;
        }

        static int IndexOfSeq(byte[] hay, byte[] needle)
        {
            for (int i = 0; i <= hay.Length - needle.Length; i++)
            {
                bool ok = true;
                for (int j = 0; j < needle.Length; j++) { if (hay[i + j] != needle[j]) { ok = false; break; } }
                if (ok) return i;
            }
            return -1;
        }

        static string GetQuery(string pathAndQuery, string name)
        {
            int q = pathAndQuery.IndexOf('?');
            if (q < 0) return null;
            foreach (string kv in pathAndQuery.Substring(q + 1).Split('&'))
            {
                int eq = kv.IndexOf('=');
                if (eq > 0 && kv.Substring(0, eq) == name) return Uri.UnescapeDataString(kv.Substring(eq + 1));
            }
            return null;
        }

        static void SendCors(NetworkStream ns)
        {
            string pre = "HTTP/1.1 204 No Content\r\n"
                + "Access-Control-Allow-Origin: *\r\n"
                + "Access-Control-Allow-Headers: *\r\n"
                + "Access-Control-Allow-Methods: POST, GET, OPTIONS\r\n"
                + "Content-Length: 0\r\n"
                + "Connection: close\r\n\r\n";
            byte[] pb = Encoding.ASCII.GetBytes(pre);
            ns.Write(pb, 0, pb.Length);
        }

        static string JsonEscape(string s)
        {
            if (s == null) return "";
            StringBuilder sb = new StringBuilder();
            foreach (char ch in s)
            {
                if (ch == '"' || ch == '\\') { sb.Append('\\'); sb.Append(ch); }
                else if (ch == '\r') sb.Append("\\r");
                else if (ch == '\n') sb.Append("\\n");
                else if (ch < ' ') sb.Append(' ');
                else sb.Append(ch);
            }
            return sb.ToString();
        }

        static string OutputDir()
        {
            string dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                "Downloads", "WPS\u5de5\u5177\u52a9\u624b");
            try { Directory.CreateDirectory(dir); } catch { }
            return dir;
        }

        // 同名文件自动加序号，避免覆盖用户已有文件
        static string DoSave(string name, byte[] data)
        {
            try
            {
                if (string.IsNullOrEmpty(name)) name = "output.bin";
                foreach (char bad in Path.GetInvalidFileNameChars()) name = name.Replace(bad, '_');
                name = Path.GetFileName(name);
                if (string.IsNullOrEmpty(name)) name = "output.bin";

                string dir = OutputDir();
                string full = Path.Combine(dir, name);
                string stem = Path.GetFileNameWithoutExtension(name);
                string ext = Path.GetExtension(name);
                int n = 1;
                while (File.Exists(full))
                {
                    full = Path.Combine(dir, stem + "(" + n + ")" + ext);
                    n++;
                }
                File.WriteAllBytes(full, data);
                return full;
            }
            catch { return null; }
        }

        // 只计算唯一的输出路径（与 DoSave 同规则），供 WPS 原生导出使用
        static string TargetPath(string name)
        {
            try
            {
                if (string.IsNullOrEmpty(name)) name = "output.pdf";
                foreach (char bad in Path.GetInvalidFileNameChars()) name = name.Replace(bad, '_');
                name = Path.GetFileName(name);
                if (string.IsNullOrEmpty(name)) name = "output.pdf";

                string dir = OutputDir();
                string full = Path.Combine(dir, name);
                string stem = Path.GetFileNameWithoutExtension(name);
                string ext = Path.GetExtension(name);
                int n = 1;
                while (File.Exists(full))
                {
                    full = Path.Combine(dir, stem + "(" + n + ")" + ext);
                    n++;
                }
                return full;
            }
            catch { return null; }
        }

        /* ================= native file picker ================= */

        // OpenFileDialog must run on an STA thread; HTTP handlers are on the pool (MTA)
        static void DoPick(NetworkStream ns, string pathAndQuery)
        {
            string filter = GetQuery(pathAndQuery, "filter");
            if (string.IsNullOrEmpty(filter)) filter = "\u6240\u6709\u6587\u4ef6|*.*";
            bool multi = GetQuery(pathAndQuery, "multi") == "1";
            bool folder = GetQuery(pathAndQuery, "mode") == "dir";
            string title = GetQuery(pathAndQuery, "title");
            if (string.IsNullOrEmpty(title)) title = "\u9009\u62e9\u6587\u4ef6";

            string[] picked = null;
            Thread t = new Thread(delegate()
            {
                // 用一个置顶的隐藏窗口做 owner，避免对话框被 WPS 主窗口盖住
                Form owner = new Form();
                try
                {
                    owner.TopMost = true;
                    owner.ShowInTaskbar = false;
                    owner.FormBorderStyle = FormBorderStyle.None;
                    owner.StartPosition = FormStartPosition.Manual;
                    owner.Location = new Point(-3000, -3000);
                    owner.Size = new Size(1, 1);
                    owner.Show();

                    if (folder)
                    {
                        using (FolderBrowserDialog d = new FolderBrowserDialog())
                        {
                            d.Description = title;
                            d.ShowNewFolderButton = false;
                            if (d.ShowDialog(owner) == DialogResult.OK) picked = new string[] { d.SelectedPath };
                        }
                    }
                    else
                    {
                        using (OpenFileDialog d = new OpenFileDialog())
                        {
                            d.Title = title;
                            d.Filter = filter;
                            d.Multiselect = multi;
                            d.CheckFileExists = true;
                            if (d.ShowDialog(owner) == DialogResult.OK) picked = d.FileNames;
                        }
                    }
                }
                catch { }
                finally { try { owner.Close(); owner.Dispose(); } catch { } }
            });
            t.SetApartmentState(ApartmentState.STA);
            t.IsBackground = true;
            t.Start();
            t.Join(600000);

            StringBuilder sb = new StringBuilder("{\"ok\":true,\"files\":[");
            if (picked != null)
            {
                for (int i = 0; i < picked.Length; i++)
                {
                    if (i > 0) sb.Append(',');
                    sb.Append('"').Append(JsonEscape(picked[i])).Append('"');
                }
            }
            sb.Append("]}");
            Log("PICK " + (picked == null ? "cancel" : picked.Length + " file(s)"));
            Send(ns, "200 OK", "application/json", Encoding.UTF8.GetBytes(sb.ToString()));
        }

        // 转发时沿用系统代理（Clash 之类），否则云端 API 会连不上
        static IWebProxy ResolveSystemProxy()
        {
            try
            {
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Internet Settings"))
                {
                    if (k == null) return null;
                    object en = k.GetValue("ProxyEnable");
                    object sv = k.GetValue("ProxyServer");
                    if (en == null || Convert.ToInt32(en) == 0 || sv == null) return null;
                    string server = sv.ToString();
                    if (server.IndexOf('=') >= 0)
                    {
                        foreach (string part in server.Split(';'))
                        {
                            if (part.StartsWith("https=", StringComparison.OrdinalIgnoreCase))
                            {
                                server = part.Substring(6);
                                break;
                            }
                        }
                    }
                    if (server.IndexOf("://") < 0) server = "http://" + server;
                    return new WebProxy(server);
                }
            }
            catch { return null; }
        }

        // 转发到模型服务，响应边收边发（SSE 流式可用）
        static void DoProxy(NetworkStream ns, string method, string pathAndQuery, string contentType, string auth, byte[] body)
        {
            string target = null;
            int q = pathAndQuery.IndexOf('?');
            if (q >= 0)
            {
                foreach (string kv in pathAndQuery.Substring(q + 1).Split('&'))
                {
                    int eq = kv.IndexOf('=');
                    if (eq > 0 && kv.Substring(0, eq) == "target")
                        target = Uri.UnescapeDataString(kv.Substring(eq + 1));
                }
            }
            if (string.IsNullOrEmpty(target))
            {
                Send(ns, "400 Bad Request", "application/json", Encoding.UTF8.GetBytes("{\"error\":\"missing target\"}"));
                return;
            }

            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(target);
                req.Method = method;
                req.ContentType = contentType;
                req.Timeout = 600000;
                req.ReadWriteTimeout = 600000;
                req.AllowAutoRedirect = true;
                req.UserAgent = "WPS-Tool-Assistant/0.1";
                req.Proxy = ResolveSystemProxy();
                if (!string.IsNullOrEmpty(auth)) req.Headers["Authorization"] = auth;
                if (body.Length > 0)
                {
                    req.ContentLength = body.Length;
                    using (Stream rs = req.GetRequestStream()) rs.Write(body, 0, body.Length);
                }
                else if (method == "POST")
                {
                    req.ContentLength = 0;
                }

                HttpWebResponse resp = null;
                try { resp = (HttpWebResponse)req.GetResponse(); }
                catch (WebException we)
                {
                    resp = we.Response as HttpWebResponse;
                    if (resp == null) throw;
                }

                using (resp)
                {
                    string rhead = "HTTP/1.1 " + (int)resp.StatusCode + " " + resp.StatusDescription + "\r\n"
                        + "Content-Type: " + (string.IsNullOrEmpty(resp.ContentType) ? "application/octet-stream" : resp.ContentType) + "\r\n"
                        + "Cache-Control: no-store\r\n"
                        + "Access-Control-Allow-Origin: *\r\n"
                        + "Connection: close\r\n\r\n";
                    byte[] hb = Encoding.ASCII.GetBytes(rhead);
                    ns.Write(hb, 0, hb.Length);
                    using (Stream s = resp.GetResponseStream())
                    {
                        byte[] buf = new byte[4096];
                        int n;
                        while ((n = s.Read(buf, 0, buf.Length)) > 0)
                        {
                            ns.Write(buf, 0, n);
                            ns.Flush();
                        }
                    }
                    Log("PROXY " + (int)resp.StatusCode + " " + target);
                }
            }
            catch (Exception ex)
            {
                Log("PROXY FAIL " + target + " : " + ex.Message);
                Send(ns, "502 Bad Gateway", "application/json", Encoding.UTF8.GetBytes("{\"error\":\"upstream unreachable\"}"));
            }
        }

        /* ================= request log (for diagnosis) ================= */
        static readonly string logPath = Path.Combine(Path.GetTempPath(), "wta-requests.log");

        static void Log(string line)
        {
            try
            {
                FileInfo fi = new FileInfo(logPath);
                if (fi.Exists && fi.Length > 200 * 1024) File.Delete(logPath);
                File.AppendAllText(logPath, DateTime.Now.ToString("MM-dd HH:mm:ss ") + line + "\r\n",
                    new UTF8Encoding(false));
            }
            catch { }
        }

        static void Send(NetworkStream ns, string status, string contentType, byte[] body)
        {
            // 中文路径/提示要让浏览器按 UTF-8 解码，否则会变成乱码
            if (contentType == null) contentType = "application/octet-stream";
            if ((contentType.StartsWith("text") || contentType.StartsWith("application/json"))
                && contentType.IndexOf("charset", StringComparison.OrdinalIgnoreCase) < 0)
                contentType += "; charset=utf-8";
            string head = "HTTP/1.1 " + status + "\r\n"
                + "Content-Type: " + contentType + "\r\n"
                + "Content-Length: " + body.Length + "\r\n"
                + "Cache-Control: no-store\r\n"
                + "Access-Control-Allow-Origin: *\r\n"
                + "Connection: close\r\n\r\n";
            byte[] h = Encoding.ASCII.GetBytes(head);
            ns.Write(h, 0, h.Length);
            ns.Write(body, 0, body.Length);
            ns.Flush();
        }

        static string MimeOf(string path)
        {
            string p = path.ToLower();
            if (p.EndsWith(".html") || p.EndsWith(".htm")) return "text/html; charset=utf-8";
            if (p.EndsWith(".js")) return "application/javascript; charset=utf-8";
            if (p.EndsWith(".css")) return "text/css; charset=utf-8";
            if (p.EndsWith(".xml")) return "text/xml; charset=utf-8";
            if (p.EndsWith(".json")) return "application/json; charset=utf-8";
            if (p.EndsWith(".png")) return "image/png";
            if (p.EndsWith(".jpg") || p.EndsWith(".jpeg")) return "image/jpeg";
            if (p.EndsWith(".webp")) return "image/webp";
            if (p.EndsWith(".gif")) return "image/gif";
            if (p.EndsWith(".bmp")) return "image/bmp";
            if (p.EndsWith(".pdf")) return "application/pdf";
            if (p.EndsWith(".svg")) return "image/svg+xml";
            return "application/octet-stream";
        }

        /* ================= publish.xml registration ================= */

        static string JsAddonsDir()
        {
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "kingsoft", "WPS", "jsaddons");
        }

        static string EntryLine(string host)
        {
            return "  <jspluginonline name=\"" + AddinName + "\" type=\"" + host + "\" url=\"http://127.0.0.1:" + port + "/" + host + "/\" debug=\"\" enable=\"enable_dev\" install=\"null\"/>";
        }

        static void WritePublishXml(string xmlPath, int portNum)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(xmlPath));
            string[] hosts = { "wps", "et", "wpp" };
            StringBuilder entries = new StringBuilder();
            foreach (string h in hosts) entries.Append(EntryLine(h)).Append("\r\n");

            string xml;
            if (File.Exists(xmlPath))
            {
                xml = File.ReadAllText(xmlPath);
                xml = StripOurEntries(xml);
                int idx = xml.IndexOf("</jsplugins>");
                if (idx >= 0) xml = xml.Insert(idx, entries.ToString());
                else xml = Header() + entries + "</jsplugins>";
            }
            else
            {
                xml = Header() + entries + "</jsplugins>";
            }
            File.WriteAllText(xmlPath, xml, new UTF8Encoding(false));
        }

        static void RemovePublishEntries(string xmlPath)
        {
            try
            {
                if (!File.Exists(xmlPath)) return;
                string xml = StripOurEntries(File.ReadAllText(xmlPath));
                File.WriteAllText(xmlPath, xml, new UTF8Encoding(false));
            }
            catch { }
        }

        static string Header()
        {
            return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\r\n<jsplugins>\r\n";
        }

        static string StripOurEntries(string xml)
        {
            string[] lines = xml.Split('\n');
            List<string> kept = new List<string>();
            foreach (string l in lines)
                if (l.IndexOf("name=\"" + AddinName + "\"") < 0) kept.Add(l);
            return string.Join("\n", kept.ToArray());
        }

        /* ================= WPS detection ================= */

        static bool WpsRunning()
        {
            string[] names = { "wps", "wpp", "wpsoffice", "ksolaunch" };
            foreach (string n in names)
            {
                try { if (Process.GetProcessesByName(n).Length > 0) return true; } catch { }
            }
            return false;
        }

        static string FindWpsExe()
        {
            string root = TryGetInstallRoot();
            if (root != null)
            {
                string[] rels = {
                    "office6\\wpsoffice.exe",
                    "office6\\wps.exe",
                    "wpsoffice.exe",
                    "office6\\ksolaunch.exe",
                    "ksolaunch.exe"
                };
                foreach (string r in rels)
                {
                    string p = Path.Combine(root, r);
                    if (File.Exists(p)) return p;
                }
            }

            string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            string pf64 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string lad = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string[] dirs = { pf, pf64, lad };
            foreach (string d in dirs)
            {
                string[] cands = {
                    d + "\\Kingsoft\\WPS Office\\office6\\wpsoffice.exe",
                    d + "\\Kingsoft\\WPS Office\\ksolaunch.exe",
                    d + "\\WPS Office\\office6\\wpsoffice.exe"
                };
                foreach (string p in cands)
                    if (!string.IsNullOrEmpty(d) && File.Exists(p)) return p;
            }
            return null;
        }

        static string TryGetInstallRoot()
        {
            string[] paths = {
                "SOFTWARE\\Kingsoft\\Office\\6.0\\Common",
                "SOFTWARE\\WOW6432Node\\Kingsoft\\Office\\6.0\\Common",
                "SOFTWARE\\Kingsoft\\Office\\6.0",
                "SOFTWARE\\WOW6432Node\\Kingsoft\\Office\\6.0"
            };
            RegistryKey[] roots = { Registry.LocalMachine, Registry.CurrentUser };
            foreach (RegistryKey root in roots)
            {
                foreach (string p in paths)
                {
                    RegistryKey k = null;
                    try { k = root.OpenSubKey(p); } catch { }
                    if (k == null) continue;
                    using (k)
                    {
                        foreach (string v in new string[] { "InstallRoot", "instroot" })
                        {
                            object o = k.GetValue(v);
                            if (!(o is string)) continue;
                            string dir = ((string)o).Trim().TrimEnd('\\');
                            if (dir.Length > 0 && Directory.Exists(dir)) return dir;
                            if (dir.Length > 0 && Directory.Exists(dir + "\\office6")) return dir;
                        }
                    }
                }
            }
            return null;
        }

        /* ================= single instance helpers ================= */

        static string PortFile()
        {
            return Path.Combine(Path.GetTempPath(), "wta-port.txt");
        }

        static void WritePortFile(int p)
        {
            try { File.WriteAllText(PortFile(), p.ToString()); } catch { }
        }

        static void DeletePortFile()
        {
            try { if (File.Exists(PortFile())) File.Delete(PortFile()); } catch { }
        }

        static int ReadPortFile()
        {
            try
            {
                if (!File.Exists(PortFile())) return 0;
                int p;
                if (int.TryParse(File.ReadAllText(PortFile()).Trim(), out p)) return p;
            }
            catch { }
            return 0;
        }

        static bool PortOpen(int p)
        {
            try
            {
                using (TcpClient c = new TcpClient())
                {
                    IAsyncResult ar = c.BeginConnect(IPAddress.Loopback, p, null, null);
                    if (!ar.AsyncWaitHandle.WaitOne(400)) return false;
                    c.EndConnect(ar);
                    return true;
                }
            }
            catch { return false; }
        }

        // 等已在运行的实例把服务准备好，返回它的端口；失败返回 0
        static int WaitForRunningPort(int timeoutMs)
        {
            int deadline = Environment.TickCount + timeoutMs;
            while (Environment.TickCount < deadline)
            {
                int p = ReadPortFile();
                if (p > 0 && PortOpen(p)) return p;
                if (PortOpen(3889)) return 3889;
                Thread.Sleep(150);
            }
            return 0;
        }

        // 第二个实例：不重复启动服务，直接“打开”助手；WPS 没开就顺手拉起
        static void RunSecondary()
        {
            if (silent)
            {
                int p0 = ReadPortFile();
                if (p0 > 0) Log("SECONDARY silent, existing port=" + p0);
                return;
            }
            int runningPort = WaitForRunningPort(6000);
            if (runningPort == 0)
            {
                Msg("\u52a9\u624b\u6b63\u5728\u542f\u52a8\u4e2d\uff0c\u8bf7 2 \u79d2\u540e\u518d\u53cc\u51fb\u4e00\u6b21\u3002", false);
                return;
            }
            port = runningPort;
            Log("OPEN existing instance port=" + port);

            // 已在运行：弹控制台窗口（不再直接抢 WPS 焦点，避免打断用户）
            ShowControlWindow(true);
        }

        // 把已在运行的 WPS 主窗口拽到前台，面板就在它右侧
        /* 把 WPS 拉到前台；返回是否真的找到并切了一个可见窗口。
         * 注意：调用方不是前台进程时 SetForegroundWindow 会被系统前台锁拒绝，
         * 所以用 keybd_event 模拟 ALT 按下 + SwitchToThisWindow 绕过。 */
        static bool ActivateWps()
        {
            try
            {
                string[] names = new string[] { "wps", "wpsoffice", "et", "wpp", "ksolaunch" };
                foreach (Process p in Process.GetProcesses())
                {
                    string n = p.ProcessName.ToLower();
                    bool hit = false;
                    foreach (string t in names) { if (n == t) { hit = true; break; } }
                    if (!hit) continue;
                    IntPtr h = p.MainWindowHandle;
                    if (h == IntPtr.Zero) continue;      // 后台进程没有窗口，跳过
                    if (IsIconic(h)) ShowWindow(h, 9);   // 最小化先还原
                    keybd_event(0x12, 0, 0, UIntPtr.Zero);        // ALT down：绕前台锁
                    SwitchToThisWindow(h, true);
                    keybd_event(0x12, 0, 2, UIntPtr.Zero);        // ALT up
                    Log("ACTIVATE " + p.ProcessName + " pid=" + p.Id);
                    return true;
                }
            }
            catch (Exception ex) { Log("ACTIVATE failed: " + ex.Message); }
            return false;
        }

        /* 打开 WPS：先试把现有窗口拉前台；没有可见窗口（只有后台进程）就直接拉起 */
        static void OpenWps()
        {
            if (ActivateWps()) return;
            string exe = FindWpsExe();
            if (exe != null)
            {
                try
                {
                    Process.Start(exe);
                    Msg("WPS \u6b63\u5728\u542f\u52a8\uff0c\u7a97\u53e3\u9a6c\u4e0a\u5f39\u51fa\u3002", false);
                }
                catch (Exception ex) { Log("OpenWps start failed: " + ex.Message); Msg("\u542f\u52a8 WPS \u5931\u8d25\uff1a" + ex.Message, true); }
            }
            else Msg("\u672a\u627e\u5230 WPS\uff0c\u8bf7\u624b\u52a8\u6253\u5f00\u3002", true);
        }

        /* ================= control window ================= */

        static Form ctrlForm;

        // 双击 exe 弹出的控制台窗口：状态 + 四个常用动作
        static void ShowControlWindow(bool ownLoop)
        {
            if (ctrlForm != null && !ctrlForm.IsDisposed)
            {
                ctrlForm.WindowState = FormWindowState.Normal;
                ctrlForm.Show();
                ctrlForm.Activate();
                return;
            }

            Form f = new Form();
            ctrlForm = f;
            f.Text = "WPS \u5de5\u5177\u52a9\u624b";
            f.FormBorderStyle = FormBorderStyle.FixedSingle;
            f.MaximizeBox = false;
            f.MinimizeBox = true;
            f.StartPosition = FormStartPosition.CenterScreen;
            f.ClientSize = new Size(336, 322);
            try { f.Icon = LoadAppIcon(); } catch { }
            f.BackColor = Color.White;

            Label title = new Label();
            title.Text = "WPS \u5de5\u5177\u52a9\u624b";
            title.Font = new Font("Microsoft YaHei", 12f, FontStyle.Bold);
            title.ForeColor = Color.FromArgb(24, 95, 165);
            title.SetBounds(18, 16, 300, 28);
            f.Controls.Add(title);

            Label svc = new Label();
            svc.Text = "\u672c\u5730\u670d\u52a1\u5df2\u542f\u52a8 \u00b7 \u7aef\u53e3 " + port;
            svc.Font = new Font("Microsoft YaHei", 8.5f);
            svc.ForeColor = Color.FromArgb(120, 120, 115);
            svc.SetBounds(18, 46, 300, 20);
            f.Controls.Add(svc);

            Label wpsSt = new Label();
            wpsSt.Text = WpsRunning() ? "WPS\uff1a\u8fd0\u884c\u4e2d" : "WPS\uff1a\u672a\u8fd0\u884c";
            wpsSt.Font = new Font("Microsoft YaHei", 8.5f);
            wpsSt.ForeColor = Color.FromArgb(120, 120, 115);
            wpsSt.SetBounds(18, 66, 300, 20);
            f.Controls.Add(wpsSt);

            Button bPanel = new Button();
            bPanel.Text = "\u6253\u5f00\u52a9\u624b\u9762\u677f";
            bPanel.Font = new Font("Microsoft YaHei", 9.5f);
            bPanel.FlatStyle = FlatStyle.Flat;
            bPanel.FlatAppearance.BorderSize = 0;
            bPanel.BackColor = Color.FromArgb(24, 95, 165);
            bPanel.ForeColor = Color.White;
            bPanel.SetBounds(18, 96, 300, 36);
            bPanel.Cursor = Cursors.Hand;
            bPanel.Click += delegate { OpenPanelStandalone(); };
            f.Controls.Add(bPanel);

            Button bWps = new Button();
            bWps.Text = "\u6253\u5f00 WPS \u7a97\u53e3";
            bWps.Font = new Font("Microsoft YaHei", 9.5f);
            bWps.SetBounds(18, 140, 300, 34);
            bWps.Click += delegate { OpenWps(); };
            f.Controls.Add(bWps);

            Button bFolder = new Button();
            bFolder.Text = "\u6253\u5f00\u4e0b\u8f7d\u6587\u4ef6\u5939";
            bFolder.Font = new Font("Microsoft YaHei", 9.5f);
            bFolder.SetBounds(18, 182, 300, 34);
            bFolder.Click += delegate { OpenDownloadFolder(); };
            f.Controls.Add(bFolder);

            Button bExit = new Button();
            bExit.Text = "\u9000\u51fa\u52a9\u624b";
            bExit.Font = new Font("Microsoft YaHei", 9.5f);
            bExit.SetBounds(18, 224, 300, 34);
            bExit.Click += delegate { ExitApp(); };
            f.Controls.Add(bExit);

            Label hint = new Label();
            hint.Text = "\u5173\u95ed\u7a97\u53e3\u4e0d\u5f71\u54cd\u4f7f\u7528\uff0c\u52a9\u624b\u5e38\u9a7b\u6258\u76d8\u3002\u6309 Ctrl+Alt+W \u53ef\u5728\u4efb\u4f55\u7a0b\u5e8f\u91cc\u5524\u8d77\u9762\u677f\u3002";
            hint.Font = new Font("Microsoft YaHei", 8f);
            hint.ForeColor = Color.FromArgb(140, 140, 135);
            hint.SetBounds(18, 266, 300, 44);
            f.Controls.Add(hint);

            // WPS 状态每 2 秒刷新一次（System.Threading.Timer 同名，必须写全名）
            System.Windows.Forms.Timer t = new System.Windows.Forms.Timer();
            t.Interval = 2000;
            t.Tick += delegate
            {
                try { wpsSt.Text = WpsRunning() ? "WPS\uff1a\u8fd0\u884c\u4e2d" : "WPS\uff1a\u672a\u8fd0\u884c"; } catch { }
            };
            t.Start();
            f.FormClosed += delegate { try { t.Stop(); t.Dispose(); } catch { } };

            if (ownLoop) Application.Run(f);
            else f.Show();
        }

        static void OpenDownloadFolder()
        {
            try
            {
                string dir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                    "Downloads", "WPS\u5de5\u5177\u52a9\u624b");
                if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
                Process.Start("explorer.exe", "\"" + dir + "\"");
            }
            catch { }
        }

        /* ================= tray ================= */

        /* 用 exe 自身嵌入的图标（由 /win32icon 打进资源），失败再退回系统图标 */
        static System.Drawing.Icon LoadAppIcon()
        {
            try
            {
                System.Drawing.Icon ic = System.Drawing.Icon.ExtractAssociatedIcon(Application.ExecutablePath);
                if (ic != null) return ic;
            }
            catch { }
            return SystemIcons.Application;
        }

        static void SetupTray()
        {
            tray = new NotifyIcon();
            tray.Icon = LoadAppIcon();
            tray.Text = "\u5de5\u5177\u52a9\u624b (127.0.0.1:" + port + ")";
            ContextMenuStrip menu = new ContextMenuStrip();
            menu.Items.Add("\u663e\u793a\u63a7\u5236\u7a97\u53e3", null, delegate { ShowControlWindow(false); });
            menu.Items.Add("\u6253\u5f00\u52a9\u624b\u9762\u677f\uff08PDF / \u65e0\u6587\u6863\u4e5f\u80fd\u7528\uff09  Ctrl+Alt+W", null, delegate { OpenPanelStandalone(); });
            menu.Items.Add("\u6253\u5f00 WPS \u7a97\u53e3", null, delegate { OpenWps(); });
            menu.Items.Add("\u5728\u6d4f\u89c8\u5668\u4e2d\u6253\u5f00\u9762\u677f\uff08\u8c03\u8bd5\u7528\uff09", null, delegate { OpenPanel(); });
            menu.Items.Add("\u542f\u52a8 WPS", null, delegate
            {
                string exe = FindWpsExe();
                if (exe != null) Process.Start(exe);
                else Msg("\u672a\u627e\u5230 WPS\uff0c\u8bf7\u624b\u52a8\u6253\u5f00\u3002", true);
            });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("\u9000\u51fa\uff08\u52a0\u8f7d\u9879\u5c06\u4e0d\u53ef\u7528\uff09", null, delegate { ExitApp(); });
            tray.ContextMenuStrip = menu;
            tray.DoubleClick += delegate { ShowControlWindow(false); };
            tray.Visible = true;

            // 全局热键：任何程序（含 WPS PDF）里按 Ctrl+Alt+W 都能拉起面板
            try
            {
                Application.AddMessageFilter(new HotKeyFilter());
                bool ok = RegisterHotKey(IntPtr.Zero, HOTKEY_ID, MOD_CONTROL | MOD_ALT, VK_W);
                Log("HOTKEY Ctrl+Alt+W " + (ok ? "registered" : "failed"));
                if (ok) NotifyHotkeyOnce();
            }
            catch (Exception ex) { Log("HOTKEY failed: " + ex.Message); }
        }

        // Balloon only on the very first successful hotkey registration, not every boot
        static void NotifyHotkeyOnce()
        {
            try
            {
                string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "WTA");
                string flag = Path.Combine(dir, "hotkey-tip-shown");
                if (File.Exists(flag)) return;
                if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
                File.WriteAllText(flag, DateTime.Now.ToString("s"));
                Notify("\u5df2\u5c31\u7eea\uff1a\u4efb\u610f\u7a97\u53e3\uff08\u5305\u62ec WPS PDF\uff09\u6309 Ctrl+Alt+W \u6253\u5f00\u52a9\u624b\u9762\u677f");
            }
            catch { }
        }

        static void Notify(string text)
        {
            try
            {
                if (tray == null) return;
                tray.BalloonTipTitle = "\u5de5\u5177\u52a9\u624b";
                tray.BalloonTipText = text;
                tray.ShowBalloonTip(4000);
            }
            catch { }
        }

        static void OpenPanel()
        {
            try { Process.Start("http://127.0.0.1:" + port + "/wps/panel.html"); } catch { }
        }

        static DateTime lastStandalone = DateTime.MinValue;

        // Standalone window: the PDF component has no js add-in support, so this is
        // the only entry there. Prefer Edge/Chrome --app (chromeless little window).
        static void OpenPanelStandalone()
        {
            if ((DateTime.UtcNow - lastStandalone).TotalSeconds < 2.0) return;
            lastStandalone = DateTime.UtcNow;
            string url = "http://127.0.0.1:" + port + "/wps/panel.html?standalone=1";
            string app = FindBrowserApp();
            if (app != null)
            {
                try
                {
                    Process.Start(new ProcessStartInfo(app, "--app=" + url + " --window-size=520,900"));
                    Log("APPWIN " + app);
                    return;
                }
                catch (Exception ex) { Log("APPWIN failed: " + ex.Message); }
            }
            try { Process.Start(url); } catch { }
        }

        // Edge / Chrome with --app support, so the panel opens as a window not a tab
        static string FindBrowserApp()
        {
            string[] cands = new string[] {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Google\Chrome\Application\chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Google\Chrome\Application\chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Google\Chrome\Application\chrome.exe")
            };
            foreach (string c in cands) { try { if (File.Exists(c)) return c; } catch { } }
            return null;
        }

        // Desktop shortcut so the panel is discoverable outside WPS (the PDF component
        // has no add-in framework, so Ctrl+Alt+W / this icon are the only entries there)
        static void CreatePanelShortcut()
        {
            try
            {
                string desk = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                string lnk = Path.Combine(desk, "WPS\u5de5\u5177\u52a9\u624b\u9762\u677f.lnk");
                string me = Process.GetCurrentProcess().MainModule.FileName;
                if (File.Exists(lnk))
                {
                    // 快捷方式指向的 exe 变了（换了目录/更新）就重建
                    object old = null;
                    try
                    {
                        object sh2 = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
                        old = sh2.GetType().InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, sh2, new object[] { lnk });
                        string tp = (string)old.GetType().InvokeMember("TargetPath", BindingFlags.GetProperty, null, old, null);
                        if (tp != null && tp.Equals(me, StringComparison.OrdinalIgnoreCase)) return;
                    }
                    catch { }
                }
                object shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
                object sc = shell.GetType().InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { lnk });
                Type t = sc.GetType();
                t.InvokeMember("TargetPath", BindingFlags.SetProperty, null, sc, new object[] { me });
                t.InvokeMember("Arguments", BindingFlags.SetProperty, null, sc, new object[] { "/panel" });
                t.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, sc, new object[] { Path.GetDirectoryName(me) });
                t.InvokeMember("IconLocation", BindingFlags.SetProperty, null, sc, new object[] { me + ",0" });
                t.InvokeMember("Description", BindingFlags.SetProperty, null, sc, new object[] { "\u6253\u5f00\u5de5\u5177\u52a9\u624b\u9762\u677f\uff08PDF / \u65e0\u6587\u6863\u4e5f\u80fd\u7528\uff09" });
                t.InvokeMember("Save", BindingFlags.InvokeMethod, null, sc, null);
                Log("SHORTCUT " + lnk);
            }
            catch (Exception ex) { Log("SHORTCUT failed: " + ex.Message); }
        }

        // 剪贴板只能在 STA 线程读；另开线程并在 3 秒后放弃，避免被别的进程锁死
        static string ReadClipboardText()
        {
            string s = "";
            try
            {
                Thread t = new Thread(delegate ()
                {
                    try { if (Clipboard.ContainsText()) s = Clipboard.GetText(); } catch { }
                });
                t.SetApartmentState(ApartmentState.STA);
                t.IsBackground = true;
                t.Start();
                t.Join(3000);
            }
            catch { }
            return s ?? "";
        }

        static void ExitApp()
        {
            try { tray.Visible = false; tray.Dispose(); } catch { }
            try { if (listener != null) listener.Stop(); } catch { }
            Application.Exit();
        }
    }
}
