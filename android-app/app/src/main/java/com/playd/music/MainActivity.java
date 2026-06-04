package com.playd.music;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
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

import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import android.content.ComponentName;
import android.media.session.MediaSession;
import android.media.session.MediaController;
import android.media.session.PlaybackState;
import android.media.MediaMetadata;

public class MainActivity extends Activity {

    private static final String PLAYD_URL = "https://playd.khurk.xyz/";
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private static final int PERMISSION_REQUEST = 1002;
    private static final String CHANNEL_ID = "playd_audio";
    private static final int NOTIFICATION_ID = 1;

    private WebView webView;
    private ValueCallback<Uri[]> fileChooserCallback;
    private MediaSession mediaSession;
    private AudioManager audioManager;

    // ── Audio Focus Listener ──────────────────────────────────────────────────
    private final AudioManager.OnAudioFocusChangeListener audioFocusListener =
        new AudioManager.OnAudioFocusChangeListener() {
            @Override
            public void onAudioFocusChange(int focusChange) {
                if (webView == null) return;
                switch (focusChange) {
                    case AudioManager.AUDIOFOCUS_GAIN:
                        webView.evaluateJavascript(
                            "if (typeof window.__playdAudioFocus === 'function') window.__playdAudioFocus('gain');",
                            null);
                        break;
                    case AudioManager.AUDIOFOCUS_LOSS:
                    case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                        webView.evaluateJavascript(
                            "if (typeof window.__playdAudioFocus === 'function') window.__playdAudioFocus('loss');",
                            null);
                        break;
                    case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK:
                        webView.evaluateJavascript(
                            "if (typeof window.__playdAudioFocus === 'function') window.__playdAudioFocus('duck');",
                            null);
                        break;
                }
            }
        };

    // ── Media Session Callback ────────────────────────────────────────────────
    private class MediaSessionCallback extends MediaSession.Callback {
        @Override
        public void onPlay() {
            webView.evaluateJavascript("if (typeof window.__playdMediaAction === 'function') window.__playdMediaAction('play');", null);
        }

        @Override
        public void onPause() {
            webView.evaluateJavascript("if (typeof window.__playdMediaAction === 'function') window.__playdMediaAction('pause');", null);
        }

        @Override
        public void onSkipToNext() {
            webView.evaluateJavascript("if (typeof window.__playdMediaAction === 'function') window.__playdMediaAction('next');", null);
        }

        @Override
        public void onSkipToPrevious() {
            webView.evaluateJavascript("if (typeof window.__playdMediaAction === 'function') window.__playdMediaAction('prev');", null);
        }

        @Override
        public void onStop() {
            webView.evaluateJavascript("if (typeof window.__playdMediaAction === 'function') window.__playdMediaAction('stop');", null);
        }

        @Override
        public void onSeekTo(long pos) {
            webView.evaluateJavascript(
                "if (typeof window.__playdMediaAction === 'function') window.__playdMediaAction('seek'," + pos + ");",
                null);
        }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);

        // Fullscreen dark
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN,
            WindowManager.LayoutParams.FLAG_FULLSCREEN
        );
        getWindow().setStatusBarColor(Color.parseColor("#0a0a0a"));
        getWindow().setNavigationBarColor(Color.parseColor("#0a0a0a"));
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // Create notification channel (Android 8+)
        createNotificationChannel();

        // Request permissions
        requestPermissions();

        // Setup WebView
        setupWebView();

        // Setup Media Session
        setupMediaSession();

        // Start foreground service for background audio
        startForegroundService();
    }

    // ── Permissions ───────────────────────────────────────────────────────────
    private void requestPermissions() {
        String[] permissions;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // Android 13+
            permissions = new String[]{
                "android.permission.READ_MEDIA_AUDIO",
                "android.permission.POST_NOTIFICATIONS"
            };
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Android 11-12
            permissions = new String[]{
                "android.permission.READ_EXTERNAL_STORAGE",
                "android.permission.POST_NOTIFICATIONS"
            };
        } else {
            // Android 10 and below
            permissions = new String[]{
                "android.permission.READ_EXTERNAL_STORAGE",
                "android.permission.WRITE_EXTERNAL_STORAGE"
            };
        }

        boolean needRequest = false;
        for (String p : permissions) {
            if (ContextCompat.checkSelfPermission(this, p) != PackageManager.PERMISSION_GRANTED) {
                needRequest = true;
                break;
            }
        }
        if (needRequest) {
            ActivityCompat.requestPermissions(this, permissions, PERMISSION_REQUEST);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        // Permissions granted or denied — the web app handles the UX
    }

    // ── WebView Setup ─────────────────────────────────────────────────────────
    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebView() {
        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setSupportZoom(false);

        // Hardware acceleration for Web Audio
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);

        // Navigation
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (url.startsWith("https://playd.khurk.xyz")) {
                    return false;
                }
                // External links → system browser
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                startActivity(intent);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                // Inject JS bridge for media session updates from the web app
                injectMediaBridge(view);
            }
        });

        // File picker + media session bridge
        webView.setWebChromeClient(new WebChromeClient() {
            // ── File Picker ───────────────────────────────────────────────────
            @Override
            public boolean onShowFileChooser(
                    WebView webView,
                    ValueCallback<Uri[]> callback,
                    FileChooserParams fileChooserParams) {

                // Cancel any pending callback
                if (fileChooserCallback != null) {
                    fileChooserCallback.onReceiveValue(null);
                }
                fileChooserCallback = callback;

                // Build intent based on what the web page requested
                Intent intent;

                String[] acceptTypes = fileChooserParams.getAcceptTypes();
                boolean isMedia = false;
                if (acceptTypes != null) {
                    for (String type : acceptTypes) {
                        if (type != null && (type.startsWith("audio/") || type.startsWith("video/") ||
                                type.contains("audio") || type.contains("video"))) {
                            isMedia = true;
                            break;
                        }
                    }
                }

                if (isMedia) {
                    // Open media picker (audio/video files)
                    intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("audio/*");
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                } else if (fileChooserParams.isCaptureEnabled()) {
                    // Camera or microphone capture
                    intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                } else {
                    // General file picker
                    intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("*/*");
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                }

                try {
                    startActivityForResult(
                        Intent.createChooser(intent, "Select files"),
                        FILE_CHOOSER_REQUEST
                    );
                } catch (Exception e) {
                    // No file manager available
                    if (fileChooserCallback != null) {
                        fileChooserCallback.onReceiveValue(null);
                        fileChooserCallback = null;
                    }
                }
                return true;
            }

            // ── Console Messages ──────────────────────────────────────────────
            @Override
            public boolean onConsoleMessage(ConsoleMessage msg) {
                return true;
            }

            // ── Progress ─────────────────────────────────────────────────────
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                // Could show a loading bar
            }
        });

        webView.loadUrl(PLAYD_URL);
    }

    // ── File Picker Result ────────────────────────────────────────────────────
    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST) {
            if (fileChooserCallback == null) return;

            if (resultCode == RESULT_OK && data != null) {
                Uri[] results = null;

                // Check for multiple files
                String dataString = data.getDataString();
                if (dataString != null) {
                    results = new Uri[]{Uri.parse(dataString)};
                } else if (data.getClipData() != null) {
                    int count = data.getClipData().getItemCount();
                    results = new Uri[count];
                    for (int i = 0; i < count; i++) {
                        results[i] = data.getClipData().getItemAt(i).getUri();
                    }
                }

                if (results != null) {
                    // Grant read permission to the WebView
                    for (Uri uri : results) {
                        getContentResolver().takePersistableUriPermission(
                            uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    }
                }
                fileChooserCallback.onReceiveValue(results);
            } else {
                fileChooserCallback.onReceiveValue(null);
            }
            fileChooserCallback = null;
        }
    }

    // ── Media Session ─────────────────────────────────────────────────────────
    private void setupMediaSession() {
        mediaSession = new MediaSession(this, "PlaydMusic");
        mediaSession.setCallback(new MediaSessionCallback());
        mediaSession.setFlags(
            MediaSession.FLAG_HANDLES_MEDIA_BUTTONS |
            MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS
        );
        mediaSession.setActive(true);
    }

    private void injectMediaBridge(WebView view) {
        // Inject JS functions that the web app can call to update media session
        String js = "(function() {" +
            "if (!window.__playdMediaSession) {" +
            "  window.__playdMediaSession = {" +
            "    updateMetadata: function(title, artist, album, duration) {" +
            "      window.__playdMetadata = {title:title, artist:artist, album:album, duration:duration};" +
            "    }," +
            "    updatePlaybackState: function(state, position) {" +
            "      window.__playdPlaybackState = {state:state, position:position};" +
            "    }" +
            "  };" +
            "}" +
            "})()";
        view.evaluateJavascript(js, null);

        // Poll for metadata updates from the web app
        pollMediaMetadata();
    }

    private Runnable mediaPollRunnable;

    private void pollMediaMetadata() {
        mediaPollRunnable = new Runnable() {
            @Override
            public void run() {
                if (webView == null) return;
                webView.evaluateJavascript(
                    "(function() {" +
                    "  var m = window.__playdMetadata || {};" +
                    "  var s = window.__playdPlaybackState || {};" +
                    "  return JSON.stringify({m:m, s:s});" +
                    "})()",
                    new ValueCallback<String>() {
                        @Override
                        public void onReceiveValue(String value) {
                            updateNativeMediaSession(value);
                        }
                    }
                );
                if (webView != null) {
                    webView.postDelayed(mediaPollRunnable, 2000);
                }
            }
        };
        if (webView != null) {
            webView.postDelayed(mediaPollRunnable, 3000);
        }
    }

    private void updateNativeMediaSession(String jsonValue) {
        if (mediaSession == null || jsonValue == null) return;

        // Parse and update MediaSession metadata
        try {
            // Simple parsing — the value is JSON
            String title = extractJsonString(jsonValue, "title");
            String artist = extractJsonString(jsonValue, "artist");
            String state = extractJsonString(jsonValue, "state");
            String positionStr = extractJsonString(jsonValue, "position");

            if (title != null && !title.isEmpty()) {
                MediaMetadata.Builder metaBuilder = new MediaMetadata.Builder();
                metaBuilder.putString(MediaMetadata.METADATA_KEY_TITLE, title);
                if (artist != null && !artist.isEmpty()) {
                    metaBuilder.putString(MediaMetadata.METADATA_KEY_ARTIST, artist);
                }
                mediaSession.setMetadata(metaBuilder.build());
            }

            if (state != null) {
                int pbState = PlaybackState.STATE_PAUSED;
                if ("playing".equals(state)) {
                    pbState = PlaybackState.STATE_PLAYING;
                }
                long pos = 0;
                try { pos = Long.parseLong(positionStr); } catch (Exception ignored) {}
                PlaybackState.Builder pbBuilder = new PlaybackState.Builder();
                pbBuilder.setState(pbState, pos, 1.0f);
                pbBuilder.setActions(
                    PlaybackState.ACTION_PLAY |
                    PlaybackState.ACTION_PAUSE |
                    PlaybackState.ACTION_SKIP_TO_NEXT |
                    PlaybackState.ACTION_SKIP_TO_PREVIOUS |
                    PlaybackState.ACTION_SEEK_TO |
                    PlaybackState.ACTION_STOP
                );
                mediaSession.setPlaybackState(pbBuilder.build());
            }
        } catch (Exception ignored) {
        }
    }

    private String extractJsonString(String json, String key) {
        try {
            int idx = json.indexOf("\"" + key + "\":");
            if (idx < 0) return null;
            idx = json.indexOf("\"", idx + key.length() + 2);
            if (idx < 0) return null;
            int end = json.indexOf("\"", idx + 1);
            if (end < 0) return null;
            return json.substring(idx + 1, end);
        } catch (Exception e) {
            return null;
        }
    }

    // ── Foreground Service / Notification ─────────────────────────────────────
    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "PLAYD Audio",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Keeps audio playing in the background");
            channel.setShowBadge(false);
            NotificationManager manager = getSystemService(NotificationManager.class);
            manager.createNotificationChannel(channel);
        }
    }

    private void startForegroundService() {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        notificationIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this, 0, notificationIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("PLAYD")
            .setContentText("Playing music")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(new Intent(this, AudioService.class));
        }
    }

    // ── Back Button ───────────────────────────────────────────────────────────
    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    @Override
    protected void onPause() {
        super.onPause();
        if (webView != null) webView.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
        // Request audio focus
        if (audioManager != null) {
            audioManager.requestAudioFocus(audioFocusListener,
                AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
        }
    }

    @Override
    protected void onDestroy() {
        if (mediaSession != null) {
            mediaSession.release();
        }
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
