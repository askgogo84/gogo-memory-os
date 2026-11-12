package in.askgogo.tvhub;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.speech.RecognizerIntent;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.InputMethodManager;
import android.content.Context;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Button;

import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Locale;
import java.util.UUID;

/**
 * Gogo TV companion: explicit WhatsApp OTP auth and foreground voice transcription.
 *
 * No passwords, session tokens, messages or microphone samples are persisted on TV.
 * Agent commands are never submitted automatically after dictation. All processing
 * is delegated to the existing authenticated AskGogo Android agent API.
 *
 * Passive wake-word detection is intentionally NOT claimed by this release.
 */
public final class GogoBrainActivity extends Activity
        implements TextToSpeech.OnInitListener {
    private static final String HOST = "https://app.askgogo.in";
    private static final int VOICE_REQUEST = 701;
    private static final int MAX_REPLY = 12000;
    private final android.os.Handler main = new android.os.Handler(
            android.os.Looper.getMainLooper());

    private FrameLayout root;
    private TextView status;
    private EditText phone;
    private EditText otp;
    private EditText prompt;
    private TextView result;
    private TextToSpeech tts;
    private String pollToken;
    private String accessToken;
    private String deviceId;
    private volatile boolean busy;
    private boolean soundEnabled;
    private boolean speaking;
    private boolean listening;
    private String lastSpoken = "";
    private long lastSpokenAt;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        root = new FrameLayout(this);
        root.setBackgroundColor(0xFF081925);
        setContentView(root);
        soundEnabled = getPreferences(MODE_PRIVATE).getBoolean("speak", false);
        deviceId = getPreferences(MODE_PRIVATE).getString("device_id", null);
        if (deviceId == null || deviceId.length() < 8) {
            deviceId = UUID.randomUUID().toString();
            getPreferences(MODE_PRIVATE).edit().putString("device_id", deviceId).apply();
        }
        // TTS can play through loud speakers. Default OFF; listening disables it.
        tts = new TextToSpeech(this, this);
        showPairing();
    }

    private int dp(float v) {
        return Math.round(getResources().getDisplayMetrics().density * v);
    }

    private GradientDrawable panel() {
        GradientDrawable d = new GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                new int[]{0xFF19465E, 0xFF0D2739});
        d.setCornerRadius(dp(14));
        d.setStroke(dp(1), 0x6686C7DA);
        return d;
    }

    private TextView label(String value, int size, int color) {
        TextView v = new TextView(this);
        v.setText(value);
        v.setTextSize(size);
        v.setTextColor(color);
        v.setGravity(Gravity.CENTER_VERTICAL);
        v.setTypeface(Typeface.create("sans-serif", Typeface.NORMAL));
        return v;
    }

    private LinearLayout page(String name, String subtitle) {
        root.removeAllViews();
        ScrollView sc = new ScrollView(this);
        sc.setFillViewport(true);
        root.addView(sc, new FrameLayout.LayoutParams(-1, -1));
        LinearLayout c = new LinearLayout(this);
        c.setOrientation(LinearLayout.VERTICAL);
        c.setPadding(dp(48), dp(22), dp(48), dp(22));
        sc.addView(c, new ScrollView.LayoutParams(-1, -1));

        c.addView(label(name, 32, Color.WHITE));
        TextView sub = label(subtitle, 14, 0xFFC3D5E2);
        LinearLayout.LayoutParams sublp = new LinearLayout.LayoutParams(-1,-2);
        sublp.topMargin = dp(7);
        sublp.bottomMargin = dp(17);
        c.addView(sub, sublp);

        status = label("", 14, 0xFFB8E4F0);
        LinearLayout.LayoutParams slp = new LinearLayout.LayoutParams(-1,-2);
        slp.bottomMargin = dp(14);
        c.addView(status, slp);
        return c;
    }

    private EditText field(LinearLayout c, String hint, boolean secret) {
        EditText e = new EditText(this);
        e.setHint(hint);
        e.setHintTextColor(0xFFB9C8D2);
        e.setTextColor(Color.WHITE);
        e.setTextSize(19);
        e.setSingleLine(true);
        e.setPadding(dp(16), dp(11), dp(16), dp(11));
        e.setBackground(panel());
        e.setInputType(secret
                ? android.text.InputType.TYPE_CLASS_NUMBER
                   | android.text.InputType.TYPE_NUMBER_VARIATION_PASSWORD
                : android.text.InputType.TYPE_CLASS_TEXT);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1,dp(56));
        lp.bottomMargin = dp(12);
        c.addView(e,lp);
        return e;
    }

    private Button action(LinearLayout c, String name, Runnable click) {
        Button b = new Button(this);
        b.setText(name);
        b.setTextColor(Color.WHITE);
        b.setAllCaps(false);
        b.setTextSize(16);
        b.setBackground(panel());
        b.setOnClickListener(v -> click.run());
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1,dp(51));
        lp.bottomMargin = dp(12);
        c.addView(b,lp);
        return b;
    }

    private void state(String text) {
        if(status!=null) status.setText(text);
    }

    private interface Callback {
        void done(JSONObject json, String problem);
    }

    private void post(String route, JSONObject data, String bearer, Callback callback) {
        if (busy) { state("A request is already in progress."); return; }
        busy = true;
        state("Connecting securely…");
        Thread task = new Thread(() -> {
            HttpURLConnection conn = null;
            JSONObject response = null;
            String error = null;
            try {
                URL url = new URL(HOST + route);
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setConnectTimeout(6000);
                conn.setReadTimeout(25000);
                conn.setUseCaches(false);
                conn.setInstanceFollowRedirects(false);
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
                conn.setRequestProperty("Accept", "application/json");
                if (bearer != null) {
                    conn.setRequestProperty("Authorization", "Bearer " + bearer);
                }
                byte[] bytes=data.toString().getBytes(StandardCharsets.UTF_8);
                if (bytes.length > 8000) throw new IllegalArgumentException("Request too large");
                try (OutputStream out=conn.getOutputStream()) { out.write(bytes); }
                int statusCode=conn.getResponseCode();
                InputStream input = statusCode >= 400 ? conn.getErrorStream() : conn.getInputStream();
                if (input == null) throw new IllegalStateException("No response");
                try (InputStream stream=input; ByteArrayOutputStream buf=new ByteArrayOutputStream()) {
                    byte[] chunk=new byte[2048];
                    int n;
                    while ((n=stream.read(chunk)) != -1) {
                        if (buf.size()+n > 96*1024) throw new IllegalStateException("Reply too large");
                        buf.write(chunk,0,n);
                    }
                    response = new JSONObject(buf.toString("UTF-8"));
                }
                if (statusCode < 200 || statusCode >= 300) {
                    String code=response.optString("error","http_" + statusCode);
                    error="Request not completed (" + code + ").";
                    response=null;
                }
            } catch (Exception ignored) {
                error = "Could not connect. Check TV network and AskGogo service.";
            } finally {
                if(conn!=null) conn.disconnect();
            }
            final JSONObject json=response;
            final String message=error;
            main.post(() -> {
                if (isFinishing() || isDestroyed()) return;
                busy=false;
                callback.done(json,message);
            });
        }, "gogo-tv-api");
        task.setDaemon(true);
        task.start();
    }

    private JSONObject request() { return new JSONObject(); }

    private void showPairing() {
        LinearLayout c=page("Connect AskGogo",
                "WhatsApp verification · Sign-in is cleared whenever you leave this screen");
        c.addView(label("Connect the same WhatsApp number you use with AskGogo.",
                16,0xFFE3F2FA));
        phone=field(c,"WhatsApp number with country code, e.g. +91…",false);
        phone.setInputType(android.text.InputType.TYPE_CLASS_PHONE);
        action(c,"Send WhatsApp verification code", () -> startOtp());
        action(c,"Return to Gogo TV",this::finish);
        c.addView(label("Your code is used once. AskGogo actions require an explicit Send; "
                + "voice dictation never sends automatically.", 13,0xFF9FB8C8));
    }

    private void startOtp() {
        String number=phone.getText().toString().trim();
        if(number.length()<10 || number.length()>30) {
            state("Enter a valid WhatsApp number with country code."); return;
        }
        JSONObject data=request();
        try {
            data.put("platform","android");
            data.put("whatsappNumber",number);
            data.put("deviceName","Gogo TV companion");
            data.put("deviceId",deviceId);
        } catch(Exception ignored) { return; }
        post("/api/mobile/link/otp/start",data,null,(response,error)->{
            if(error!=null) { state(error); return; }
            String token=response.optString("pollToken","");
            if(token.length()<32) { state("Could not start verification."); return; }
            pollToken=token;
            showOtp();
        });
    }

    private void showOtp() {
        LinearLayout c=page("Verify your WhatsApp",
                "Enter the six-digit code sent by AskGogo. Expires after 10 minutes.");
        otp=field(c,"6-digit WhatsApp OTP",true);
        action(c,"Verify and connect",this::verifyOtp);
        action(c,"Start again",this::showPairing);
        c.addView(label("Only use a code you requested. Do not speak the code aloud.",
                13,0xFF9AB5C7));
    }

    private void verifyOtp() {
        String code=otp.getText().toString().trim();
        if(!code.matches("[0-9]{6}") || pollToken == null) {
            state("Enter the exact six-digit code."); return;
        }
        JSONObject data=request();
        try { data.put("pollToken",pollToken);data.put("code",code); }
        catch(Exception ignored) { return; }
        otp.setText("");
        post("/api/mobile/link/otp/verify",data,null,(response,error)->{
            if(error!=null || !response.optBoolean("approved",false)) {
                state(error!=null?error:"Incorrect or expired code.");return;
            }
            exchangeSession();
        });
    }

    private void exchangeSession() {
        if(pollToken==null) {showPairing();return;}
        JSONObject data=request();
        try {
            data.put("platform","android");
            data.put("pollToken",pollToken);
            data.put("deviceId",deviceId);
            data.put("deviceName","Gogo TV companion");
        } catch(Exception ignored) { return; }
        post("/api/mobile/session/exchange",data,null,(response,error)->{
            if(error!=null) {state(error);return;}
            String token=response.optString("accessToken","");
            if(token.length()<32) {state("Pairing session missing. Start again.");return;}
            accessToken=token;
            pollToken=null;
            showAssistant();
        });
    }

    private void showAssistant() {
        if(accessToken==null) {showPairing();return;}
        LinearLayout c=page("AskGogo · Same Brain",
                "Shared TV • Auto-sign-out when leaving. Review and Send each request.");
        result=label("Connected. Try: What's on my calendar tomorrow?",20,Color.WHITE);
        result.setPadding(dp(14),dp(12),dp(14),dp(12));
        result.setBackground(panel());
        LinearLayout.LayoutParams replyLP=new LinearLayout.LayoutParams(-1,dp(130));
        replyLP.bottomMargin=dp(10);
        c.addView(result,replyLP);
        prompt=field(c,"Type or dictate a request…",false);
        action(c,"Dictate with TV microphone",this::listen);
        action(c,"Send to AskGogo",this::sendPrompt);
        action(c,"Voice replies: " + (soundEnabled ? "ON" : "OFF"),()->{
            soundEnabled=!soundEnabled;
            getPreferences(MODE_PRIVATE).edit().putBoolean("speak",soundEnabled).apply();
            showAssistant();
        });
        action(c,"Disconnect this TV session",this::logout);
        c.addView(label("Voice is push-to-talk; passive Hey Gogo wake word is not "
                + "enabled. All commands are submitted only after explicit confirmation.",
                13,0xFF9FB8CA));
        prompt.requestFocus();
    }

    private void sendPrompt() {
        if(accessToken==null) {showPairing();return;}
        String text=prompt.getText().toString().trim();
        if(text.isEmpty()) {state("Type or dictate a request first.");return;}
        if(text.length()>2000) {state("Request is too long.");return;}
        // Confirmation prevents inadvertent actions triggered by microphone playback.
        new AlertDialog.Builder(this)
                .setTitle("Send to AskGogo?")
                .setMessage(text)
                .setNegativeButton("Cancel",null)
                .setPositiveButton("Send",(dialog,which)->submit(text))
                .show();
    }

    private void submit(String text) {
        if(accessToken==null) return;
        JSONObject data=request();
        try { data.put("text",text); }
        catch(Exception ignored) {return;}
        post("/api/agent/run",data,accessToken,(response,error)->{
            if(error!=null) {
                state(error);
                if(error.contains("unauthorized")){accessToken=null;showPairing();}
                return;
            }
            String reply=response.optString("text","");
            if(reply.isEmpty()) reply=response.optString("status","No response");
            if(reply.length()>MAX_REPLY) reply=reply.substring(0,MAX_REPLY)+"…";
            result.setText(reply);
            state("AskGogo responded. Check the message before any follow-up.");
            if(prompt!=null) prompt.setText("");
            if(soundEnabled) speak(reply);
        });
    }

    private void listen() {
        if(listening || speaking || busy) {
            state("Audio or a request is already active.");return;
        }
        if(tts!=null) tts.stop();
        try {
            Intent intent=new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                    RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE,"en-IN");
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS,1);
            intent.putExtra(RecognizerIntent.EXTRA_PROMPT,"Speak to AskGogo");
            listening=true;
            startActivityForResult(intent,VOICE_REQUEST);
        } catch(ActivityNotFoundException | SecurityException e) {
            listening=false;
            state("No speech-recognition service available on this TV.");
        }
    }

    @Override protected void onActivityResult(int request,int code,Intent data) {
        super.onActivityResult(request,code,data);
        if(request!=VOICE_REQUEST) return;
        listening=false;
        if(code!=RESULT_OK || data==null) {
            state("Voice input cancelled.");return;
        }
        ArrayList<String> texts=data.getStringArrayListExtra(
                RecognizerIntent.EXTRA_RESULTS);
        if(texts==null || texts.isEmpty()) {state("No speech recognized.");return;}
        String phrase=texts.get(0).trim();
        if(phrase.length()>2000) phrase=phrase.substring(0,2000);
        long now=android.os.SystemClock.elapsedRealtime();
        if(phrase.equalsIgnoreCase(lastSpoken) && now-lastSpokenAt < 5000) {
            state("Duplicate speech ignored (echo guard).");return;
        }
        lastSpoken=phrase;lastSpokenAt=now;
        if(prompt!=null) prompt.setText(phrase);
        state("Draft filled from microphone. Review and press Send.");
    }

    @Override public void onInit(int code) {
        if (code == TextToSpeech.SUCCESS && tts != null) {
            tts.setLanguage(Locale.forLanguageTag("en-IN"));
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) {
                    main.post(() -> speaking = true);
                }
                @Override public void onDone(String id) {
                    main.post(() -> speaking = false);
                }
                @Override public void onError(String id) {
                    main.post(() -> speaking = false);
                }
            });
        }
    }

    private void speak(String text) {
        if(tts==null || listening) return;
        String spoken=text.length()>400 ? text.substring(0,400) : text;
        speaking=true;
        // Stop any previous response before speaking a new one.
        tts.stop();
        tts.speak(spoken,TextToSpeech.QUEUE_FLUSH,null,"gogo-tv-response");
    }

    private void logout() {
        String token=accessToken;
        accessToken=null;
        pollToken=null;
        if(tts!=null) tts.stop();
        speaking=false;
        if(token!=null) {
            post("/api/mobile/session/logout",request(),token,(json,error)->{
                // Even if server is temporarily unavailable, local bearer is discarded.
                showPairing();
                state(error==null?"TV session disconnected.":
                        "Local session cleared. Remote revocation could not be verified.");
            });
        } else showPairing();
    }

    @Override public void onBackPressed() {
        if(accessToken!=null) {
            new AlertDialog.Builder(this)
                    .setTitle("Leave AskGogo?")
                    .setMessage("This is a shared TV. Disconnect the account before leaving?")
                    .setPositiveButton("Disconnect",(d,w)->logout())
                    .setNegativeButton("Stay",null)
                    .show();
        } else super.onBackPressed();
    }

    @Override protected void onStop() {
        super.onStop();
        // A shared-screen security boundary: leaving the Assistant to Home or
        // another app removes access to the account immediately. The external
        // speech dialog is the only permitted interruption.
        if (!listening) {
            accessToken = null;
            pollToken = null;
            if (tts != null) tts.stop();
            speaking = false;
            lastSpoken = "";
            if (!isFinishing()) showPairing();
        }
    }

    @Override protected void onDestroy() {
        // The access token is never persisted and is destroyed with this Activity.
        pollToken=null;accessToken=null;
        if(tts!=null){tts.stop();tts.shutdown();tts=null;}
        main.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}
