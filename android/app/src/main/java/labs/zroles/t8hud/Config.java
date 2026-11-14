package labs.zroles.t8hud;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Iterator;
import java.util.List;
import java.util.regex.Pattern;

/** The same settings as the bridge's config.json, kept in the app's private storage. */
final class Config {
    private static final List<String> PALETTES = Arrays.asList("cyber", "amber", "mono", "custom");
    private static final Pattern COLOR = Pattern.compile("^#[0-9a-fA-F]{6}$");
    private static final Pattern HOST = Pattern.compile("^[\\w.-]+$");

    private final Context ctx;
    private final File file;
    JSONObject cfg;

    Config(Context ctx) {
        this.ctx = ctx;
        this.file = new File(ctx.getFilesDir(), "config.json");
        reload();
    }

    synchronized void reload() {
        try {
            JSONObject base = new JSONObject(readAsset(ctx, "config.example.json"));
            JSONObject user = readUser();
            JSONObject out = new JSONObject(base.toString());
            for (Iterator<String> it = user.keys(); it.hasNext(); ) { String k = it.next(); out.put(k, user.get(k)); }
            JSONObject display = new JSONObject(base.getJSONObject("display").toString());
            JSONObject ud = user.optJSONObject("display");
            if (ud != null) for (Iterator<String> it = ud.keys(); it.hasNext(); ) { String k = it.next(); display.put(k, ud.get(k)); }
            out.put("display", display);
            // a fresh install has no T8 yet: the example address must never be polled
            if (!user.has("t8Host")) out.put("t8Host", "");
            // the signal chain, DAC window and stats are labs extras, as on the bridge
            boolean labs = user.optBoolean("labs", false);
            out.put("labs", labs);
            if (!labs) { display.put("showChain", false); display.put("showStats", false); display.put("showDac", false); }
            if (!COLOR.matcher(display.optString("customColor")).matches()) display.put("customColor", "#ff2bd6");
            cfg = out;
        } catch (Exception e) {
            throw new RuntimeException("config: " + e.getMessage(), e);
        }
    }

    String t8Host() { return cfg.optString("t8Host", ""); }
    int t8Port() { return cfg.optInt("t8Port", 9529); }
    int pollMs() { return Math.max(500, cfg.optInt("pollMs", 1000)); }
    int timeoutMs() { return cfg.optInt("timeoutMs", 6000); }
    boolean autoDiscover() { return cfg.optBoolean("autoDiscover", true); }

    private JSONObject readUser() {
        try {
            if (!file.exists()) return new JSONObject();
            return new JSONObject(new String(readAll(new java.io.FileInputStream(file)), StandardCharsets.UTF_8));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    synchronized void writeUser(JSONObject patch) throws IOException, JSONException {
        JSONObject user = readUser();
        for (Iterator<String> it = patch.keys(); it.hasNext(); ) { String k = it.next(); user.put(k, patch.get(k)); }
        File tmp = new File(file.getPath() + ".tmp");
        try (FileOutputStream o = new FileOutputStream(tmp)) { o.write((user.toString(2) + "\n").getBytes(StandardCharsets.UTF_8)); }
        if (!tmp.renameTo(file)) throw new IOException("could not save settings");
        reload();
    }

    // ---- the setup page's settings, validated the same way as server.js cleanSettings() ----
    private static String str(Object v, int max) {
        if (!(v instanceof String)) return "";
        String s = ((String) v).trim();
        return s.length() > max ? s.substring(0, max) : s;
    }
    private static String str(Object v) { return str(v, 40); }

    JSONObject clean(JSONObject b) throws JSONException {
        JSONObject out = new JSONObject();
        if (b.has("t8Host")) {
            String h = str(b.opt("t8Host"), 64);
            if (!h.isEmpty() && !HOST.matcher(h).matches()) throw new IllegalArgumentException("That T8 address does not look right");
            if (!"demo".equals(h)) out.put("t8Host", h);
        }
        if (b.has("chain")) {
            JSONArray in = b.optJSONArray("chain");
            if (in == null) throw new IllegalArgumentException("bad chain");
            JSONArray arr = new JSONArray();
            for (int i = 0; i < Math.min(16, in.length()); i++) {
                JSONObject c = in.optJSONObject(i);
                if (c == null) continue;
                JSONObject o = new JSONObject();
                if ("link".equals(c.opt("kind"))) o.put("kind", "link");
                if (!str(c.opt("from")).isEmpty()) o.put("from", str(c.opt("from")));
                o.put("model", str(c.opt("model")));
                o.put("brand", str(c.opt("brand")));
                o.put("type", str(c.has("type") ? c.opt("type") : c.opt("role")));
                if (!o.getString("model").isEmpty() || !o.getString("brand").isEmpty() || !o.getString("type").isEmpty()) arr.put(o);
            }
            out.put("chain", arr);
        }
        if (b.has("sources")) {
            JSONObject in = b.optJSONObject("sources");
            if (in == null) throw new IllegalArgumentException("bad sources");
            JSONObject o = new JSONObject();
            int n = 0;
            for (Iterator<String> it = in.keys(); it.hasNext() && n < 30; n++) {
                String k = str(it.next());
                if (k.isEmpty()) continue;
                JSONObject v = in.optJSONObject(k);
                String name = v == null ? "" : str(v.opt("name")), note = v == null ? "" : str(v.opt("note"));
                if (!name.isEmpty() || !note.isEmpty()) o.put(k, new JSONObject().put("name", name).put("note", note));
            }
            out.put("sources", o);
        }
        if (b.has("dacWindow")) {
            JSONObject w = b.optJSONObject("dacWindow");
            if (w == null) w = new JSONObject();
            JSONArray items = new JSONArray();
            JSONArray in = w.optJSONArray("items");
            if (in != null) for (int i = 0; i < Math.min(8, in.length()); i++) {
                JSONObject it = in.optJSONObject(i);
                if (it == null) continue;
                String l = str(it.opt("label"), 24), v = str(it.opt("value"));
                if (!l.isEmpty() || !v.isEmpty()) items.put(new JSONObject().put("label", l).put("value", v));
            }
            out.put("dacWindow", new JSONObject().put("title", str(w.opt("title"))).put("items", items));
        }
        if (b.has("device")) {
            JSONObject d = b.optJSONObject("device");
            if (d == null) d = new JSONObject();
            out.put("device", new JSONObject().put("brand", str(d.opt("brand"))).put("type", str(d.has("type") ? d.opt("type") : d.opt("role"))));
        }
        if (b.has("display")) {
            JSONObject d = b.optJSONObject("display");
            if (d == null) d = new JSONObject();
            JSONObject o = new JSONObject(cfg.getJSONObject("display").toString());
            if (PALETTES.contains(d.optString("palette"))) o.put("palette", d.optString("palette"));
            if (d.has("eqLabel")) o.put("eqLabel", str(d.opt("eqLabel")));
            if (d.has("eqNote")) o.put("eqNote", str(d.opt("eqNote")));
            if (d.has("showEq")) o.put("showEq", d.optBoolean("showEq"));
            if (d.has("showClock")) o.put("showClock", d.optBoolean("showClock"));
            if (d.has("showFlask")) o.put("showFlask", d.optBoolean("showFlask"));
            if (d.has("customColor") && COLOR.matcher(d.optString("customColor")).matches()) o.put("customColor", d.optString("customColor").toLowerCase());
            if (d.has("nightAfterIdleMinutes")) o.put("nightAfterIdleMinutes", Math.max(0, Math.min(600, (int) Math.round(d.optDouble("nightAfterIdleMinutes", 0)))));
            if (cfg.optBoolean("labs")) {
                if (d.has("showStats")) o.put("showStats", d.optBoolean("showStats"));
                if (d.has("showChain")) o.put("showChain", d.optBoolean("showChain"));
                if (d.has("showDac")) o.put("showDac", d.optBoolean("showDac"));
            }
            if (d.has("animatePath")) o.put("animatePath", d.optBoolean("animatePath"));
            pick(d, o, "font", "classic", "modern", "serif", "terminal");
            pick(d, o, "textSize", "standard", "large", "xlarge");
            pick(d, o, "beadShape", "glow", "dot", "diamond", "dash");
            pick(d, o, "beadColor", "format", "hardware", "white");
            pick(d, o, "beadSize", "medium", "small", "large");
            pick(d, o, "beadSpeed", "normal", "slow", "fast");
            out.put("display", o);
        }
        return out;
    }

    private static void pick(JSONObject d, JSONObject o, String k, String... ok) throws JSONException {
        if (!d.has(k)) return;
        String v = d.optString(k);
        o.put(k, Arrays.asList(ok).contains(v) ? v : ok[0]);
    }

    // ---- helpers ----
    static String readAsset(Context ctx, String name) throws IOException {
        try (InputStream in = ctx.getAssets().open(name)) { return new String(readAll(in), StandardCharsets.UTF_8); }
    }

    static byte[] readAll(InputStream in) throws IOException {
        try (InputStream i = in) {
            ByteArrayOutputStream o = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            for (int n; (n = i.read(buf)) > 0; ) o.write(buf, 0, n);
            return o.toByteArray();
        }
    }
}
