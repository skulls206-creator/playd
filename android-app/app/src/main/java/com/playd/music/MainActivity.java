package com.playd.music;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {

    private static final String PLAYD_URL = "https://playd.khurk.xyz/";
    private WebView webView;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Fullscreen immersive
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN,
            WindowManager.LayoutParams.FLAG_FULLSCREEN
        );

        // Dark status bar
        getWindow().setStatusBarColor(Color.parseColor("#0a0a0a"));
        getWindow().setNavigationBarColor(Color.parseColor("#0a0a0a"));

        // Create WebView
        webView = new WebView(this);
        setContentView(webView);

        // Configure WebView
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);       // IndexedDB support
        settings.setDatabaseEnabled(true);          // IndexedDB support
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);  // Auto-play audio
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setSupportZoom(false);

        // Enable Web Audio
        settings.setAllowUniversalAccessFromFileURLs(true);

        // Keep screen on while in app
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // Handle page navigation
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                // Keep same-origin navigation in WebView
                if (url.startsWith("https://playd.khurk.xyz") || url.startsWith("https://playd.khurk.xyz/")) {
                    return false; // Load in WebView
                }
                // Open external links in browser
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                startActivity(intent);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                // Inject media session fix for background audio
                view.evaluateJavascript(
                    "if ('mediaSession' in navigator) { navigator.mediaSession.setActionHandler('play', () => {}); }",
                    null
                );
            }
        });

        // Handle console messages
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage msg) {
                return true; // Suppress console in production
            }

            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                // Could show a loading indicator here
            }
        });

        // Enable hardware acceleration for audio
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);

        // Load the PWA
        webView.loadUrl(PLAYD_URL);
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (webView != null) {
            webView.onPause();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
        }
    }
}
