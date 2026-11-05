package labs.zroles.t8hud;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * Full-screen HUD. Any remote key on the HUD opens a small menu (Settings · About · Exit); Menu goes
 * straight to setup. On setup, Back returns to the HUD; Back on the HUD (menu closed) closes the app. The screen stays on while the app is open.
 */
public final class MainActivity extends Activity {
    private static HudServer server; // one per process, survives the activity being recreated
    private WebView web;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable updateTick = new Runnable() {
        @Override public void run() { if (server != null) server.updater.maybeCheck(); handler.postDelayed(this, 600_000); }
    };

    @SuppressLint("SetJavaScriptEnabled")
    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (server == null) server = new HudServer(this);
        if (BuildConfig.VERSION_NAME.contains("dev")) WebView.setWebContentsDebuggingEnabled(true);

        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportMultipleWindows(false); // window.open() (Preview, Open live HUD) loads right here
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                // stay on the app's own pages; there is no browser to hand other links to on most TVs
                return !"127.0.0.1".equals(r.getUrl().getHost());
            }
        });
        web.setFocusable(true);
        setContentView(web);
        hideSystemUi();
    }

    @Override protected void onStart() {
        super.onStart();
        try {
            server.start();
            if (web.getUrl() == null) web.loadUrl(base() + "/");
        } catch (Exception e) {
            Log.e("T8HUD", "server", e);
            web.loadData("<body style='background:#000;color:#fff;font:24px sans-serif;padding:40px'>T8 HUD could not start its local server: "
                    + android.text.TextUtils.htmlEncode(String.valueOf(e.getMessage())) + "</body>", "text/html", "utf-8");
        }
        handler.post(updateTick);
    }

    @Override protected void onStop() {
        handler.removeCallbacks(updateTick);
        // nothing on screen, nothing to poll: the T8 is left alone while the app is in the background
        server.stop();
        super.onStop();
    }

    @Override protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }

    @Override public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUi();
    }

    private String base() { return "http://127.0.0.1:" + server.port; }

    private String page() {
        String u = web.getUrl();
        if (u == null) return "";
        Uri uri = Uri.parse(u);
        String p = uri.getPath() == null ? "/" : uri.getPath();
        return uri.getQueryParameter("preview") != null ? "preview" : p.equals("/setup") ? "setup" : "hud";
    }

    @Override public boolean dispatchKeyEvent(KeyEvent e) {
        int k = e.getKeyCode();
        boolean hud = page().equals("hud");
        boolean open = k == KeyEvent.KEYCODE_DPAD_CENTER || k == KeyEvent.KEYCODE_ENTER || k == KeyEvent.KEYCODE_NUMPAD_ENTER
                || k == KeyEvent.KEYCODE_MENU || k == KeyEvent.KEYCODE_SETTINGS;
        if (hud && (k == KeyEvent.KEYCODE_MENU || k == KeyEvent.KEYCODE_SETTINGS)) {
            if (e.getAction() == KeyEvent.ACTION_UP) web.loadUrl(base() + "/setup");
            return true;
        }
        // On the HUD the page owns the remote: a first press opens the small menu (Settings · About · Exit),
        // the D-pad moves along it, OK picks, Back closes it. The page answers what the app has to do.
        String key = k == KeyEvent.KEYCODE_DPAD_LEFT ? "left" : k == KeyEvent.KEYCODE_DPAD_RIGHT ? "right"
                : k == KeyEvent.KEYCODE_DPAD_UP ? "up" : k == KeyEvent.KEYCODE_DPAD_DOWN ? "down"
                : open ? "ok" : k == KeyEvent.KEYCODE_BACK ? "back" : null;
        if (hud && key != null) {
            if (e.getAction() == KeyEvent.ACTION_UP) {
                // before the page has loaded: Back still exits and OK still opens setup
                String fallback = key.equals("back") ? "'exit'" : key.equals("ok") ? "'settings'" : "''";
                web.evaluateJavascript("window.t8Key ? t8Key('" + key + "') : " + fallback, v -> {
                    if ("\"settings\"".equals(v)) web.loadUrl(base() + "/setup");
                    else if ("\"exit\"".equals(v)) finish();
                });
            }
            return true;
        }
        if (k == KeyEvent.KEYCODE_BACK) {
            if (e.getAction() != KeyEvent.ACTION_UP) return true;
            if (hud) finish();
            else web.loadUrl(base() + (page().equals("preview") ? "/setup" : "/"));
            return true;
        }
        return super.dispatchKeyEvent(e);
    }

    private void hideSystemUi() {
        web.setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }
}
