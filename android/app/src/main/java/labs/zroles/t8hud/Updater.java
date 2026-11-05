package labs.zroles.t8hud;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Asks GitHub (the only thing the app ever contacts outside your home network) whether a newer
 * release is out, and on request downloads its APK and hands it to Android's installer.
 */
final class Updater {
    static final String REPO = "ZRolesLabs/t8-hud";
    private static final String DOWNLOAD_PREFIX = "https://github.com/" + REPO + "/releases/download/";
    private static final long EVERY_MS = 6 * 3600_000L;

    static final class Release {
        String version, page, apkUrl;
        boolean newer;
    }

    private final Context ctx;
    volatile Release latest;
    volatile String status = "";
    private volatile long lastCheck = 0;
    private volatile boolean busy;

    Updater(Context ctx) { this.ctx = ctx; }

    void checkSoon() {
        if (busy || System.currentTimeMillis() - lastCheck < 60_000) return;
        new Thread(this::check, "hud-update-check").start();
    }

    /** Called every poll cycle from the activity's timer; cheap unless a check is due. */
    void maybeCheck() { if (System.currentTimeMillis() - lastCheck > EVERY_MS) checkSoon(); }

    private void check() {
        busy = true;
        lastCheck = System.currentTimeMillis();
        try {
            HttpURLConnection c = (HttpURLConnection) new URL("https://api.github.com/repos/" + REPO + "/releases/latest").openConnection();
            c.setConnectTimeout(8000); c.setReadTimeout(8000);
            c.setRequestProperty("Accept", "application/vnd.github+json");
            c.setRequestProperty("User-Agent", "t8-hud-tv");
            try {
                if (c.getResponseCode() == 404) { status = "No releases yet"; return; }
                if (c.getResponseCode() != 200) throw new IOException("GitHub said HTTP " + c.getResponseCode());
                JSONObject j = new JSONObject(new String(Config.readAll(c.getInputStream()), StandardCharsets.UTF_8));
                Release r = new Release();
                r.version = j.optString("tag_name").replaceFirst("^[vV]", "");
                r.page = j.optString("html_url");
                JSONArray assets = j.optJSONArray("assets");
                if (assets != null) for (int i = 0; i < assets.length(); i++) {
                    JSONObject a = assets.getJSONObject(i);
                    String url = a.optString("browser_download_url");
                    if (a.optString("name").endsWith(".apk") && url.startsWith(DOWNLOAD_PREFIX)) { r.apkUrl = url; break; }
                }
                r.newer = compare(r.version, BuildConfig.VERSION_NAME) > 0;
                latest = r;
                status = r.newer ? "Version " + r.version + " is available" : "Up to date";
            } finally { c.disconnect(); }
        } catch (Exception e) {
            status = "Could not check for updates: " + e.getMessage();
            Log.w("T8HUD", status);
        } finally { busy = false; }
    }

    /** "1.10.0" vs "1.9.2-dev.4": compares the numbers only. */
    static int compare(String a, String b) {
        String[] x = a.split("[.-]"), y = b.split("[.-]");
        for (int i = 0; i < 3; i++) {
            int p = i < x.length ? toInt(x[i]) : 0, q = i < y.length ? toInt(y[i]) : 0;
            if (p != q) return Integer.compare(p, q);
        }
        return 0;
    }
    private static int toInt(String s) { try { return Integer.parseInt(s); } catch (NumberFormatException e) { return 0; } }

    /** Returns null when the installer was opened, or a message saying what went wrong. */
    String downloadAndInstall() {
        Release r = latest;
        if (r == null || !r.newer || r.apkUrl == null) return "No update to install.";
        if (Build.VERSION.SDK_INT >= 26 && !ctx.getPackageManager().canRequestPackageInstalls()) {
            try {
                ctx.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.getPackageName())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                return "Allow T8 HUD to install apps on the screen that just opened, then press Install again.";
            } catch (ActivityNotFoundException e) {
                return "Allow T8 HUD to install unknown apps in the TV's settings (Apps › Security), then press Install again.";
            }
        }
        try {
            status = "Downloading " + r.version + "…";
            File dir = new File(ctx.getCacheDir(), "updates");
            if (!dir.exists() && !dir.mkdirs()) throw new IOException("no space for the download");
            File apk = new File(dir, UpdateFileProvider.FILE);
            download(r.apkUrl, apk);
            status = "Opening the installer…";
            Intent i = new Intent(Intent.ACTION_VIEW)
                    .setDataAndType(UpdateFileProvider.uri(), "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            return null;
        } catch (Exception e) {
            status = "Update failed: " + e.getMessage();
            return status;
        }
    }

    private static void download(String url, File to) throws IOException {
        for (int hops = 0; hops < 5; hops++) {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(10000); c.setReadTimeout(30000);
            c.setInstanceFollowRedirects(false);
            c.setRequestProperty("User-Agent", "t8-hud-tv");
            try {
                int code = c.getResponseCode();
                if (code >= 300 && code < 400) {
                    String next = new URL(new URL(url), c.getHeaderField("Location")).toString();
                    if (!next.startsWith("https://")) throw new IOException("refusing a non-HTTPS download");
                    url = next; continue;
                }
                if (code != 200) throw new IOException("HTTP " + code);
                try (InputStream in = c.getInputStream(); FileOutputStream o = new FileOutputStream(to)) {
                    byte[] buf = new byte[65536];
                    long n = 0;
                    for (int k; (k = in.read(buf)) > 0; ) { o.write(buf, 0, k); if ((n += k) > 100_000_000) throw new IOException("download too large"); }
                }
                return;
            } finally { c.disconnect(); }
        }
        throw new IOException("too many redirects");
    }
}
