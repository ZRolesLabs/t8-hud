package labs.zroles.t8hud;

import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

/**
 * The bridge, inside the TV app: polls the T8, serves the HUD page and the setup page, proxies cover
 * art. The page itself runs the same normaliser as the PC bridge (lib/normalize.js), so both builds
 * read the T8 the same way. Listens on the LAN too, so the setup page also opens on a phone.
 */
final class HudServer {
    private static final String TAG = "T8HUD";
    static final int FIRST_PORT = 8080;
    private static final Pattern ID_KEY = Pattern.compile("^[\\w-]{1,32}$");

    private final Context ctx;
    final Config config;
    final Updater updater;
    private ServerSocket socket;
    private ExecutorService pool;
    private volatile boolean running;
    private Thread poller;
    int port = -1;

    // live state
    private volatile String host = "";
    private volatile String lastRaw = null;
    private volatile long lastRawAt = 0;
    private volatile JSONObject link = linkObj(false, "Connecting…");
    private int failures = 0;
    private long lastScan = 0;
    private final Set<String> seenSources = Collections.synchronizedSet(new LinkedHashSet<String>());
    private final Map<String, byte[]> artCache = Collections.synchronizedMap(new LinkedHashMap<String, byte[]>(32, .75f, true) {
        @Override protected boolean removeEldestEntry(Map.Entry<String, byte[]> e) { return size() > 30; }
    });

    HudServer(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        this.config = new Config(this.ctx);
        this.updater = new Updater(this.ctx);
        JSONArray seen = config.cfg.optJSONArray("seenSources");
        if (seen != null) for (int i = 0; i < seen.length(); i++) seenSources.add(seen.optString(i));
    }

    synchronized void start() throws IOException {
        if (running) return;
        host = config.t8Host();
        IOException last = null;
        for (int p = FIRST_PORT; p < FIRST_PORT + 10; p++) {
            try {
                ServerSocket s = new ServerSocket();
                s.setReuseAddress(true);
                s.bind(new InetSocketAddress(p));
                socket = s; port = p; break;
            } catch (IOException e) { last = e; }
        }
        if (socket == null) throw last != null ? last : new IOException("no free port");
        running = true;
        pool = Executors.newCachedThreadPool();
        Thread acceptor = new Thread(this::acceptLoop, "hud-accept");
        acceptor.setDaemon(true);
        acceptor.start();
        poller = new Thread(this::pollLoop, "hud-poll");
        poller.setDaemon(true);
        poller.start();
        updater.checkSoon();
        Log.i(TAG, "HUD server on port " + port + ", T8 " + (host.isEmpty() ? "(not set)" : host));
    }

    synchronized void stop() {
        running = false;
        try { if (socket != null) socket.close(); } catch (IOException ignored) {}
        socket = null;
        if (pool != null) pool.shutdownNow();
        if (poller != null) poller.interrupt();
    }

    boolean hasT8() { return !host.isEmpty(); }
    boolean isConnected() { return link.optBoolean("connected"); }

    // ---------------------------------------------------------------- T8 polling
    private static JSONObject linkObj(boolean connected, String error) {
        try { return new JSONObject().put("connected", connected).put("error", error == null ? JSONObject.NULL : error).put("since", System.currentTimeMillis()); }
        catch (Exception e) { return new JSONObject(); }
    }

    private void pollLoop() {
        while (running) {
            try {
                if (host.isEmpty()) {
                    setLink(false, "No T8 set yet");
                    discover(true);
                } else {
                    String raw = new String(t8Get(host, "/ZidooMusicControl/v2/getState", config.timeoutMs()), StandardCharsets.UTF_8);
                    JSONObject j = new JSONObject(raw);
                    lastRaw = raw; lastRawAt = System.currentTimeMillis();
                    failures = 0;
                    setLink(true, null);
                    noteSource(j.optJSONObject("everSoloPlayInfo"));
                }
            } catch (Exception e) {
                if (!host.isEmpty()) {
                    setLink(false, e instanceof java.net.SocketTimeoutException ? "no answer within " + config.timeoutMs() / 1000 + "s" : String.valueOf(e.getMessage()));
                    if (++failures >= 3) discover(false);
                }
            }
            try { Thread.sleep(config.pollMs()); } catch (InterruptedException e) { return; }
        }
    }

    private void setLink(boolean connected, String error) {
        boolean was = link.optBoolean("connected");
        String wasErr = link.optString("error", null);
        if (was != connected || (error != null && !error.equals(wasErr))) link = linkObj(connected, error);
    }

    private void noteSource(JSONObject info) {
        String sub = info == null ? "" : info.optString("playTypeSubtitle", "");
        if (sub.isEmpty() || seenSources.contains(sub)) return;
        seenSources.add(sub);
        try {
            List<String> all = new ArrayList<>(seenSources);
            config.writeUser(new JSONObject().put("seenSources", new JSONArray(all.subList(Math.max(0, all.size() - 50), all.size()))));
        } catch (Exception ignored) {}
    }

    byte[] t8Get(String h, String pathAndQuery, int timeoutMs) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL("http://" + h + ":" + config.t8Port() + pathAndQuery).openConnection();
        c.setConnectTimeout(Math.min(timeoutMs, 3000));
        c.setReadTimeout(timeoutMs);
        c.setUseCaches(false);
        // the T8's small server prefers one request per connection and few headers
        c.setRequestProperty("Connection", "close");
        c.setRequestProperty("Accept", "*/*");
        try {
            if (c.getResponseCode() != 200) throw new IOException("HTTP " + c.getResponseCode());
            return Config.readAll(c.getInputStream());
        } finally { c.disconnect(); }
    }

    /** Sweep the home network for a T8. Saves the address when exactly one T8 answers. */
    private void discover(boolean firstRun) {
        if (!config.autoDiscover() && !firstRun) return;
        if (System.currentTimeMillis() - lastScan < 60000) return;
        lastScan = System.currentTimeMillis();
        List<JSONObject> found = scanLan();
        if (found.isEmpty()) return;
        String h = found.get(0).optString("host");
        if (firstRun && found.size() > 1) return; // more than one: let the person pick on the setup page
        if (!h.equals(host)) {
            Log.i(TAG, "found the T8 at " + h);
            try { config.writeUser(new JSONObject().put("t8Host", h)); } catch (Exception ignored) {}
            host = h; failures = 0;
        }
    }

    List<JSONObject> scanLan() {
        List<JSONObject> found = Collections.synchronizedList(new ArrayList<JSONObject>());
        ExecutorService ex = Executors.newFixedThreadPool(64);
        try {
            List<Future<?>> jobs = new ArrayList<>();
            for (String prefix : lanPrefixes()) {
                for (int i = 1; i < 255; i++) {
                    final String h = prefix + "." + i;
                    jobs.add(ex.submit(() -> {
                        try (Socket s = new Socket()) { s.connect(new InetSocketAddress(h, config.t8Port()), 900); }
                        catch (IOException e) { return; }
                        try {
                            JSONObject st = new JSONObject(new String(t8Get(h, "/ZidooMusicControl/v2/getState", 3000), StandardCharsets.UTF_8));
                            if (st.has("deviceInfo") || st.has("playingMusic") || st.has("state")) {
                                JSONObject dev = st.optJSONObject("deviceInfo");
                                found.add(new JSONObject().put("host", h).put("name", dev == null ? "" : dev.optString("deviceName"))
                                        .put("model", dev == null ? "" : dev.optString("model")));
                            }
                        } catch (Exception ignored) {}
                    }));
                }
            }
            for (Future<?> f : jobs) { try { f.get(20, TimeUnit.SECONDS); } catch (Exception ignored) {} }
        } finally { ex.shutdownNow(); }
        return new ArrayList<>(found);
    }

    private List<String> lanPrefixes() {
        Set<String> out = new LinkedHashSet<>();
        if (host.matches("^\\d+\\.\\d+\\.\\d+\\.\\d+$")) out.add(host.substring(0, host.lastIndexOf('.')));
        for (String a : lanAddresses()) out.add(a.substring(0, a.lastIndexOf('.')));
        return new ArrayList<>(out);
    }

    /** This TV's IPv4 addresses on the home network. */
    static List<String> lanAddresses() {
        List<String> out = new ArrayList<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback() || ni.getName().matches("(?i).*(tun|wg|ppp|docker|veth|dummy|rmnet).*")) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    String s = a.getHostAddress();
                    if (a instanceof Inet4Address && s.matches("^(10|172|192)\\..*") && !s.startsWith("169.254.")) out.add(s);
                }
            }
        } catch (Exception ignored) {}
        return out;
    }

    // ---------------------------------------------------------------- HTTP
    private void acceptLoop() {
        while (running) {
            try {
                final Socket s = socket.accept();
                pool.execute(() -> handle(s));
            } catch (Exception e) {
                if (running) Log.w(TAG, "accept: " + e);
            }
        }
    }

    private static final class Req {
        String method, path, query = "";
        Map<String, String> params = new HashMap<>();
        Map<String, String> headers = new HashMap<>();
        byte[] body = new byte[0];
        String remote;
    }

    private void handle(Socket s) {
        try (Socket sock = s) {
            sock.setSoTimeout(15000);
            InputStream in = new BufferedInputStream(sock.getInputStream());
            Req r = new Req();
            r.remote = sock.getInetAddress().getHostAddress();
            String line = readLine(in);
            if (line == null) return;
            String[] parts = line.split(" ");
            if (parts.length < 2) return;
            r.method = parts[0];
            String target = parts[1];
            int q = target.indexOf('?');
            r.path = URLDecoder.decode(q < 0 ? target : target.substring(0, q), "UTF-8");
            if (q >= 0) {
                r.query = target.substring(q + 1);
                for (String kv : r.query.split("&")) {
                    int e = kv.indexOf('=');
                    if (e > 0) r.params.put(URLDecoder.decode(kv.substring(0, e), "UTF-8"), URLDecoder.decode(kv.substring(e + 1), "UTF-8"));
                }
            }
            for (String h; (h = readLine(in)) != null && !h.isEmpty(); ) {
                int c = h.indexOf(':');
                if (c > 0) r.headers.put(h.substring(0, c).trim().toLowerCase(Locale.ROOT), h.substring(c + 1).trim());
            }
            int len = 0;
            try { len = Integer.parseInt(r.headers.containsKey("content-length") ? r.headers.get("content-length") : "0"); } catch (NumberFormatException ignored) {}
            if (len > 65536) { send(sock.getOutputStream(), 413, "text/plain", "too large".getBytes(), null); return; }
            if (len > 0) {
                r.body = new byte[len];
                for (int off = 0; off < len; ) { int n = in.read(r.body, off, len - off); if (n < 0) break; off += n; }
            }
            route(r, sock.getOutputStream());
        } catch (Exception e) {
            Log.w(TAG, "http: " + e);
        }
    }

    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        for (int c; (c = in.read()) >= 0; ) {
            if (c == '\n') return b.toString("UTF-8").replace("\r", "");
            if (b.size() > 8192) throw new IOException("line too long");
            b.write(c);
        }
        return b.size() == 0 ? null : b.toString("UTF-8");
    }

    private void route(Req r, OutputStream out) throws Exception {
        String p = r.path;
        switch (p) {
            case "/t8/state": {
                JSONObject j = new JSONObject().put("link", link).put("rawAt", lastRawAt);
                j.put("raw", lastRaw == null || !isConnected() ? JSONObject.NULL : new JSONObject(lastRaw));
                json(out, j); return;
            }
            case "/api/raw": send(out, 200, "application/json", (lastRaw == null ? "{}" : lastRaw).getBytes(StandardCharsets.UTF_8), null); return;
            case "/api/state": json(out, new JSONObject().put("link", link).put("state", JSONObject.NULL)); return;
            case "/api/config": json(out, publicConfig()); return;
            case "/api/settings":
                if ("GET".equals(r.method)) { json(out, settings()); return; }
                if (!allowed(r)) { forbidden(out); return; }
                try {
                    JSONObject clean = config.clean(new JSONObject(new String(r.body, StandardCharsets.UTF_8)));
                    config.writeUser(clean);
                    if (clean.has("t8Host") && !clean.getString("t8Host").equals(host)) { host = clean.getString("t8Host"); failures = 0; lastRaw = null; setLink(false, "Connecting…"); }
                    json(out, new JSONObject().put("ok", true));
                } catch (Exception e) {
                    send(out, 400, "application/json", new JSONObject().put("error", String.valueOf(e.getMessage())).toString().getBytes(StandardCharsets.UTF_8), null);
                }
                return;
            case "/api/find-t8": {
                if (!"POST".equals(r.method) || !allowed(r)) { forbidden(out); return; }
                json(out, new JSONObject().put("found", new JSONArray(scanLan()))); return;
            }
            case "/app/update": {
                // only the TV itself can start an install (the installer then asks on screen)
                if (!"POST".equals(r.method) || !isLocal(r.remote) || !sameOrigin(r)) { forbidden(out); return; }
                String err = updater.downloadAndInstall();
                json(out, err == null ? new JSONObject().put("ok", true) : new JSONObject().put("error", err)); return;
            }
            case "/app/check-update": updater.checkSoon(); json(out, new JSONObject().put("ok", true)); return;
            case "/art/preview": asset(out, "samples/demo-cover.jpg", "image/jpeg", "max-age=86400"); return;
            case "/": page(out, "public/index.html", false); return;
            case "/setup": page(out, "public/setup.html", true); return;
            case "/lib/normalize.js": normalizer(out); return;
            case "/events": send(out, 404, "text/plain", "The TV app has no event stream; the page polls /t8/state.".getBytes(), null); return;
            default:
        }
        if (p.startsWith("/art/")) { art(r, out); return; }
        if (p.startsWith("/app/") && p.endsWith(".js")) { asset(out, "app/" + p.substring(5), "text/javascript; charset=utf-8", "no-store"); return; }
        if (p.equals("/samples/getState-dsd64-deacon-blues.json")) { asset(out, "samples/getState-dsd64-deacon-blues.json", "application/json", "no-store"); return; }
        if (p.contains("..")) { send(out, 404, "text/plain", "Not found".getBytes(), null); return; }
        String rel = "public" + p;
        asset(out, rel, mime(p), p.endsWith(".woff2") ? "max-age=31536000" : "no-store");
    }

    private boolean allowed(Req r) { return isLan(r.remote) && sameOrigin(r); }
    private static boolean isLocal(String a) { return a.equals("127.0.0.1") || a.equals("::1") || a.equals("0:0:0:0:0:0:0:1") || a.startsWith("::ffff:127."); }
    private static boolean isLan(String addr) {
        String a = addr.replaceFirst("^::ffff:", "");
        return isLocal(addr) || a.matches("^(127\\.|10\\.|192\\.168\\.|172\\.(1[6-9]|2\\d|3[01])\\.|169\\.254\\.|100\\.(6[4-9]|[7-9]\\d|1[01]\\d|12[0-7])\\.).*") || a.matches("(?i)^f[cd].*");
    }
    private static boolean sameOrigin(Req r) {
        String o = r.headers.get("origin");
        if (o == null || o.equals("null")) return true;
        try { URL u = new URL(o); String hostPort = u.getHost() + (u.getPort() > 0 ? ":" + u.getPort() : ""); return hostPort.equals(r.headers.get("host")); }
        catch (Exception e) { return false; }
    }

    private JSONObject publicConfig() throws Exception {
        JSONObject c = config.cfg;
        return new JSONObject()
                .put("chain", c.opt("chain")).put("sources", c.optJSONObject("sources") != null ? c.opt("sources") : new JSONObject())
                .put("device", c.optJSONObject("device") != null ? c.opt("device") : new JSONObject())
                .put("dacWindow", c.optJSONObject("dacWindow") != null ? c.opt("dacWindow") : new JSONObject().put("title", "").put("items", new JSONArray()))
                .put("display", c.get("display")).put("labs", c.optBoolean("labs")).put("demo", false)
                .put("t8Host", host).put("build", BuildConfig.VERSION_NAME).put("version", BuildConfig.VERSION_NAME)
                .put("app", appInfo());
    }

    private JSONObject appInfo() throws Exception {
        JSONObject a = new JSONObject().put("platform", "tv").put("version", BuildConfig.VERSION_NAME).put("port", port);
        Updater.Release rel = updater.latest;
        if (rel != null && rel.newer) a.put("update", new JSONObject().put("version", rel.version).put("page", rel.page).put("canInstall", rel.apkUrl != null));
        a.put("updateStatus", updater.status);
        return a;
    }

    private JSONObject settings() throws Exception {
        JSONObject c = config.cfg;
        JSONArray urls = new JSONArray();
        for (String a : lanAddresses()) urls.put("http://" + a + ":" + port + "/setup");
        return new JSONObject().put("t8Host", host).put("chain", c.opt("chain"))
                .put("sources", c.optJSONObject("sources") != null ? c.opt("sources") : new JSONObject())
                .put("device", c.optJSONObject("device") != null ? c.opt("device") : new JSONObject())
                .put("dacWindow", c.optJSONObject("dacWindow") != null ? c.opt("dacWindow") : new JSONObject().put("title", "").put("items", new JSONArray()))
                .put("display", c.get("display")).put("seenSources", new JSONArray(new ArrayList<>(seenSources)))
                .put("lanUrls", urls).put("link", link).put("palettes", new JSONArray(new String[]{"cyber", "amber", "mono", "custom"}))
                .put("demo", false).put("labs", c.optBoolean("labs")).put("version", BuildConfig.VERSION_NAME).put("app", appInfo());
    }

    // ---- pages: the shared HUD files, plus the app's small bridge script ----
    private void page(OutputStream out, String file, boolean setup) throws IOException {
        String html = Config.readAsset(ctx, file);
        String v = "?b=" + BuildConfig.VERSION_NAME;
        String inject = setup
                ? "<script src=\"/app/setup-tv.js" + v + "\"></script>\n</body>"
                : "<script src=\"/lib/normalize.js" + v + "\"></script>\n<script src=\"/app/bridge.js" + v + "\"></script>\n<script src=\"app.js";
        html = setup ? html.replace("</body>", inject) : html.replace("<script src=\"app.js", inject);
        html = html.replaceAll("(href|src)=\"((?:fonts/fonts\\.css|style\\.css|app\\.js))\"", "$1=\"$2" + v + "\"");
        send(out, 200, "text/html; charset=utf-8", html.getBytes(StandardCharsets.UTF_8), "no-store");
    }

    /** lib/normalize.js is a Node module; wrap it so the page can use it as-is. */
    private void normalizer(OutputStream out) throws IOException {
        String src = Config.readAsset(ctx, "lib/normalize.js");
        String js = "(function(){var module={exports:{}},exports=module.exports;\n"
                + "var require=function(n){if(n!=='crypto')throw new Error(n);return{createHash:function(){var d='';return{update:function(s){d+=s;return this},digest:function(){return window.T8HUD_HASH(d)}}}}};\n"
                + src + "\nwindow.T8N=module.exports;})();\n";
        send(out, 200, "text/javascript; charset=utf-8", js.getBytes(StandardCharsets.UTF_8), "no-store");
    }

    private void asset(OutputStream out, String name, String type, String cache) throws IOException {
        byte[] b;
        try { b = Config.readAll(ctx.getAssets().open(name)); }
        catch (IOException e) { send(out, 404, "text/plain", "Not found".getBytes(), null); return; }
        send(out, 200, type, b, cache);
    }

    // ---- cover art: only what the T8's own answer points at ----
    private void art(Req r, OutputStream out) throws IOException {
        String key = r.path.substring(5);
        String kind = r.params.get("k"), value = r.params.get("v");
        byte[] buf = artCache.get(key);
        if (buf == null && kind != null && value != null && ID_KEY.matcher(key).matches()) {
            String raw = lastRaw == null ? "" : lastRaw;
            boolean seen = raw.contains(value) || raw.contains(value.replace("/", "\\/"));
            try {
                if (kind.equals("id") && ID_KEY.matcher(value).matches())
                    buf = t8Get(host, "/ZidooMusicControl/v2/getImage?id=" + java.net.URLEncoder.encode(value, "UTF-8") + "&musicType=0&type=0&target=16", 8000);
                else if (kind.equals("path") && seen && value.startsWith("/"))
                    buf = t8Get(host, value, 8000);
                else if (kind.equals("url") && seen && value.matches("(?i)^https?://.*"))
                    buf = fetchUrl(value);
            } catch (Exception e) { Log.w(TAG, "art " + key + ": " + e.getMessage()); }
            if (buf != null && imageType(buf) != null) artCache.put(key, buf); else buf = null;
        }
        if (buf == null) { send(out, 404, "text/plain", new byte[0], null); return; }
        send(out, 200, imageType(buf), buf, "max-age=86400");
    }

    private static byte[] fetchUrl(String u) throws IOException {
        for (int hops = 0; hops < 4; hops++) {
            HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection();
            c.setConnectTimeout(8000); c.setReadTimeout(8000);
            c.setInstanceFollowRedirects(false);
            c.setRequestProperty("Accept", "image/*");
            c.setRequestProperty("User-Agent", "t8-hud");
            try {
                int code = c.getResponseCode();
                if (code >= 300 && code < 400 && c.getHeaderField("Location") != null) { u = new URL(new URL(u), c.getHeaderField("Location")).toString(); continue; }
                if (code != 200) throw new IOException("HTTP " + code);
                if (c.getContentLength() > 15_000_000) throw new IOException("image too large");
                return Config.readAll(c.getInputStream());
            } finally { c.disconnect(); }
        }
        throw new IOException("too many redirects");
    }

    static String imageType(byte[] b) {
        if (b.length < 12) return null;
        if ((b[0] & 0xff) == 0xff && (b[1] & 0xff) == 0xd8) return "image/jpeg";
        if ((b[0] & 0xff) == 0x89 && b[1] == 0x50) return "image/png";
        String head = new String(b, 0, 12, StandardCharsets.ISO_8859_1);
        if (head.startsWith("RIFF") && head.substring(8, 12).equals("WEBP")) return "image/webp";
        if (head.startsWith("GIF")) return "image/gif";
        return null;
    }

    // ---- responses ----
    private static String mime(String p) {
        String l = p.toLowerCase(Locale.ROOT);
        if (l.endsWith(".html")) return "text/html; charset=utf-8";
        if (l.endsWith(".js")) return "text/javascript; charset=utf-8";
        if (l.endsWith(".css")) return "text/css; charset=utf-8";
        if (l.endsWith(".woff2")) return "font/woff2";
        if (l.endsWith(".json")) return "application/json";
        if (l.endsWith(".svg")) return "image/svg+xml";
        if (l.endsWith(".png")) return "image/png";
        if (l.endsWith(".jpg") || l.endsWith(".jpeg")) return "image/jpeg";
        if (l.endsWith(".txt")) return "text/plain; charset=utf-8";
        return "application/octet-stream";
    }

    private static void json(OutputStream out, JSONObject j) throws IOException {
        send(out, 200, "application/json", j.toString().getBytes(StandardCharsets.UTF_8), "no-store");
    }

    private static void forbidden(OutputStream out) throws IOException {
        send(out, 403, "application/json", "{\"error\":\"Changes are only accepted from the setup page on your own network.\"}".getBytes(StandardCharsets.UTF_8), null);
    }

    private static void send(OutputStream out, int code, String type, byte[] body, String cache) throws IOException {
        String reason = code == 200 ? "OK" : code == 404 ? "Not Found" : code == 403 ? "Forbidden" : code == 400 ? "Bad Request" : "Error";
        StringBuilder h = new StringBuilder("HTTP/1.1 ").append(code).append(' ').append(reason).append("\r\n")
                .append("Content-Type: ").append(type).append("\r\n")
                .append("Content-Length: ").append(body.length).append("\r\n")
                .append("Cache-Control: ").append(cache == null ? "no-store" : cache).append("\r\n")
                .append("Connection: close\r\n\r\n");
        out.write(h.toString().getBytes(StandardCharsets.ISO_8859_1));
        out.write(body);
        out.flush();
    }
}
