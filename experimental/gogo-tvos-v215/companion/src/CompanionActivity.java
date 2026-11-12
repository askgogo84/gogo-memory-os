package in.askgogo.tvhub;

import android.Manifest;
import android.app.AlertDialog;
import android.graphics.Bitmap;
import android.os.Build;
import android.util.Base64;
import android.view.Gravity;
import android.view.inputmethod.InputMethodManager;
import android.widget.ImageView;
import java.security.MessageDigest;
import java.security.SecureRandom;
import android.content.pm.PackageManager;
import android.media.AudioManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.text.InputType;
import android.view.View;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.Button;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

public final class CompanionActivity extends GogoHubActivity {
    private enum Page { HOME, PROFILES, ASK, PAIR, SETTINGS, CONTROLS }
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final ExecutorService microphone = Executors.newSingleThreadExecutor();
    private ProfileStore profiles;
    private Page page;
    private int slot;
    private volatile int generation;
    private boolean foreground;
    private boolean busy;
    private String token;
    private String pending;
    private String pairingCode;
    private String pairingQr;
    private String sessionCandidate;
    private long pairingDeadline;
    private boolean polling;
    private boolean temporarySession;
    private TextView pairingStatus;
    private final Runnable poll = this::pollPairing;
    private String draft = "";
    private String answer = "";
    private String status = "";
    private EditText question;
    private byte[] audio;
    private VoiceCapture capture;
    private WakeListener wake;
    private boolean wakeArmed;
    private TextToSpeech speaker;
    private boolean speakerReady;
    private long silentUntil;

    @Override protected void onCreate(Bundle state) {
        profiles = new ProfileStore(getSharedPreferences("gogo_tv_profiles", MODE_PRIVATE));
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        super.onCreate(state);
    }

    @Override protected void onResume() {
        super.onResume();
        foreground = true;
        schedulePoll(0);
    }

    @Override protected void onPause() {
        foreground = false;
        handler.removeCallbacks(poll);
        if (wakeArmed || capture != null || audio != null) status = "";
        wakeArmed = false;
        stopWake();
        if (capture != null) {
            capture.stop();
            capture = null;
        }
        clearAudio();
        stopPlayback();
        if (page == Page.ASK && !marketsOpen()) showAsk();
        super.onPause();
    }

    @Override protected void onStop() {
        lock();
        showHub();
        super.onStop();
    }

    @Override protected void onDestroy() {
        generation++;
        handler.removeCallbacksAndMessages(null);
        worker.shutdown();
        microphone.shutdownNow();
        if (speaker != null) speaker.shutdown();
        super.onDestroy();
    }

    private void lock() {
        generation++;
        busy = false;
        revokeQuietly(sessionCandidate);
        if (temporarySession) revokeQuietly(token);
        resetPairing();
        slot = 0;
        token = null;
        temporarySession = false;
        draft = "";
        answer = "";
        status = "";
        wakeArmed = false;
        stopWake();
        stopPlayback();
        if (capture != null) capture.stop();
        capture = null;
        clearAudio();
    }

    private void clearAudio() {
        if (audio != null) Arrays.fill(audio, (byte) 0);
        audio = null;
    }

    private LinearLayout screen(Page next, String heading) {
        page = next;
        question = null;
        closeMarkets();
        root.removeAllViews();
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setDescendantFocusability(ScrollView.FOCUS_AFTER_DESCENDANTS);
        root.addView(scroll, new android.widget.FrameLayout.LayoutParams(-1, -1));
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setPadding(dp(44), dp(19), dp(44), dp(16));
        scroll.addView(column);
        column.addView(title(heading, 29, 0xFFFFFFFF));
        if (!status.isEmpty()) {
            TextView message = title(status, 16, 0xFFC4DEEB);
            message.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
            message.setPadding(0, dp(5), 0, dp(8));
            column.addView(message);
        }
        return column;
    }

    @Override protected void showHub() {
        wakeArmed = false;
        stopWake();
        stopPlayback();
        if (capture != null) capture.stop();
        capture = null;
        clearAudio();
        draft = "";
        answer = "";
        LinearLayout column = screen(Page.HOME, "Gogo TV  ·  " + profileName(slot));
        LinearLayout row = new LinearLayout(this);
        column.addView(row);
        LinearLayout primary = tileColumn(row);
        LinearLayout secondary = tileColumn(row);
        if (profiles.enabled(slot, "ask", true)) {
            addAction(primary, "AskGogo", token == null ? "Pair with your phone" : "Ask by typing or voice",
                    this::openAssistant);
        }
        if (profiles.enabled(slot, "markets", true))
            addAction(primary, "Markets", "TradingView market overview", this::openMarkets);
        addAction(secondary, "Profiles", "Switch or lock your AskGogo profile", this::showProfiles);
        addAction(secondary, "TV controls", "Volume and Couch TV remote", this::showControls);
        addAction(secondary, "Settings", "Choose which features appear", this::showSettings);
        if (primary.getChildCount() > 0) focus(primary, 0); else focus(secondary, 0);
    }

    private void openAssistant() {
        status = "";
        if (slot == 0) {
            if (profiles.paired(1) || profiles.paired(2) || profiles.paired(3)) {
                showProfiles();
                return;
            }
            slot = 1;
        }
        if (token == null) startPairing(); else showAsk();
    }

    @Override protected void addAction(LinearLayout column, String heading, String description, Runnable action) {
        super.addAction(column, heading, description, action);
        LinearLayout button = (LinearLayout) column.getChildAt(column.getChildCount() - 1);
        for (int index = 0; index < button.getChildCount(); index++)
            button.getChildAt(index).setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        button.setContentDescription(heading + ". " + description);
        button.setAccessibilityDelegate(new View.AccessibilityDelegate() {
            @Override public void onInitializeAccessibilityNodeInfo(View host, AccessibilityNodeInfo info) {
                super.onInitializeAccessibilityNodeInfo(host, info);
                info.setClassName(Button.class.getName());
            }
        });
    }

    @Override protected boolean showMarketStatus() { return true; }

    private LinearLayout tileColumn(LinearLayout row) {
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams layout = new LinearLayout.LayoutParams(0, -2, 1);
        layout.setMargins(0, dp(12), dp(12), 0);
        row.addView(column, layout);
        return column;
    }

    private void showProfiles() {
        LinearLayout column = screen(Page.PROFILES, "Gogo TV profiles");
        int first = column.getChildCount();
        addAction(column, "Guest", "Public dashboard", () -> { lock(); showHub(); });
        for (int index = 1; index <= 3; index++) {
            final int profile = index;
            addAction(column, profileName(index), profiles.paired(index) ? "PIN protected" : "Pair with AskGogo",
                    () -> selectProfile(profile));
        }
        focus(column, first);
    }

    private String profileName(int profile) { return profile == 0 ? "Guest" : "Profile " + profile; }

    private void selectProfile(int profile) {
        if (busy) return;
        lock();
        slot = profile;
        if (!profiles.paired(slot)) {
            startPairing();
            return;
        }
        long wait = profiles.secondsUntilUnlock(slot);
        if (wait > 0) {
            lock();
            status = "Try that profile again in " + wait + " seconds.";
            showProfiles();
            return;
        }
        pinDialog(false);
    }

    private void pinDialog(boolean create) {
        final int selected = slot;
        final int current = generation;
        LinearLayout fields = new LinearLayout(this);
        fields.setOrientation(LinearLayout.VERTICAL);
        fields.setPadding(dp(24), 0, dp(24), 0);
        EditText input = pinField("Profile PIN");
        EditText confirmation = pinField("Confirm PIN");
        fields.addView(input);
        if (create) fields.addView(confirmation);
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle(create ? "Create a private profile PIN" : "Unlock " + profileName(slot))
                .setMessage(create ? "Use 6–12 digits. Keep this PIN private." : "Enter your profile PIN.")
                .setView(fields).setNegativeButton("Cancel", (d, w) -> { if (!create) { lock(); showProfiles(); } })
                .setPositiveButton(create ? "Save" : "Unlock", null).create();
        dialog.setOnCancelListener(d -> { if (!create) { lock(); showProfiles(); } });
        dialog.setOnShowListener(d -> {
            View positive = dialog.getButton(AlertDialog.BUTTON_POSITIVE);
            positive.setId(View.generateViewId());
            confirmation.setId(View.generateViewId());
            input.setNextFocusDownId(create ? confirmation.getId() : positive.getId());
            confirmation.setNextFocusDownId(positive.getId());
            input.setOnEditorActionListener((field, action, event) -> {
                if (action != EditorInfo.IME_ACTION_DONE) return false;
                if (create) confirmation.requestFocus(); else positive.performClick();
                return true;
            });
            confirmation.setOnEditorActionListener((field, action, event) -> {
                if (action != EditorInfo.IME_ACTION_DONE) return false;
                positive.performClick();
                return true;
            });
            positive.setOnClickListener(view -> {
                if (busy || current != generation) return;
                String pin = input.getText().toString();
                if (!pin.matches("[0-9]{6,12}")) { input.setError("Use 6–12 digits."); return; }
                if (create && !pin.contentEquals(confirmation.getText())) { confirmation.setError("PINs differ."); return; }
                String candidate = token;
                input.setText("");
                confirmation.setText("");
                dialog.dismiss();
                run(() -> {
                    JSONObject result = new JSONObject();
                    if (create) {
                        profiles.save(selected, pin, candidate);
                        result.put("token", candidate);
                    } else {
                        result.put("token", profiles.unlock(selected, pin));
                    }
                    return result;
                }, result -> {
                    token = result.optString("token", null);
                    if (token == null) {
                        lock();
                        status = "PIN did not match.";
                        showProfiles();
                    } else {
                        temporarySession = false;
                        status = create ? "Profile saved until this TV session expires." : "";
                        showHub();
                    }
                });
            });
        });
        dialog.show();
    }

    private EditText pinField(String hint) {
        EditText field = new EditText(this);
        field.setSingleLine();
        field.setSaveEnabled(false);
        field.setHint(hint);
        field.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(12)});
        field.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        field.setImeOptions(EditorInfo.IME_ACTION_DONE | EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING);
        return field;
    }

    private void startPairing() {
        if (busy) return;
        status = "Creating your pairing code…";
        showPair();
        run(() -> {
            byte[] secret = new byte[32];
            new SecureRandom().nextBytes(secret);
            String candidate = "gtv_" + Base64.encodeToString(secret, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
            Arrays.fill(secret, (byte) 0);
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(candidate.getBytes(StandardCharsets.US_ASCII));
            StringBuilder hex = new StringBuilder(64);
            for (byte value : digest) hex.append(Character.forDigit((value & 255) >>> 4, 16))
                    .append(Character.forDigit(value & 15, 16));
            JSONObject body = new JSONObject().put("sessionHash", hex.toString()).put("deviceName", Build.MODEL);
            JSONObject result = TvApi.request("device", "POST", null, "application/json",
                    body.toString().getBytes(StandardCharsets.UTF_8));
            return result.put("localCandidate", candidate);
        }, result -> {
            pending = result.getString("proof");
            sessionCandidate = result.getString("localCandidate");
            pairingCode = result.getString("code");
            pairingQr = result.getString("qr");
            pairingDeadline = SystemClock.elapsedRealtime() + 1000L * result.getInt("pairSeconds");
            status = "Waiting for approval on your phone…";
            showPair();
            schedulePoll(1000L * result.getInt("interval"));
        });
    }

    private void showPair() {
        LinearLayout column = screen(Page.PAIR, "Pair " + profileName(slot));
        pairingStatus = status.isEmpty() ? null : (TextView) column.getChildAt(1);
        int first = column.getChildCount();
        if (pending != null) {
            LinearLayout row = new LinearLayout(this);
            row.setGravity(Gravity.CENTER_VERTICAL);
            column.addView(row);
            first++;
            int size = dp(224);
            Bitmap bitmap = PairingQr.create(BuildConfig.ORIGIN + "/tv/pair#" + pairingQr + "." + pairingCode, size);
            if (bitmap != null) {
                ImageView image = new ImageView(this);
                image.setImageBitmap(bitmap);
                image.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
                row.addView(image, new LinearLayout.LayoutParams(size, size));
            }
            LinearLayout instructions = new LinearLayout(this);
            instructions.setOrientation(LinearLayout.VERTICAL);
            instructions.setPadding(dp(20), 0, 0, 0);
            row.addView(instructions);
            if (bitmap != null) instructions.addView(title("Scan with your phone camera", 24, 0xFFFFFFFF));
            instructions.addView(title("Or open " + BuildConfig.ORIGIN + "/tv/pair", 17, 0xFFC4DEEB));
            TextView code = title(pairingCode.substring(0, 4) + "-" + pairingCode.substring(4), 32, 0xFFFFFFFF);
            code.setContentDescription("Pairing code " + pairingCode.replaceAll("(.)", "$1 ").trim());
            code.setFocusable(true);
            code.setOnFocusChangeListener((view, focused) ->
                    view.setBackgroundColor(focused ? 0xFF205772 : 0x00000000));
            instructions.addView(code);
        } else if (!"Creating your pairing code…".equals(status)) {
            addAction(column, "Get a new code", "Create a QR code for your phone", this::startPairing);
        }
        addAction(column, "Cancel pairing", "Return to profiles", this::cancelPairing);
        focus(column, first);
    }

    private void schedulePoll(long delay) {
        handler.removeCallbacks(poll);
        if (foreground && page == Page.PAIR && pending != null) handler.postDelayed(poll, delay);
    }

    private void pollPairing() {
        if (!foreground || page != Page.PAIR || pending == null || polling) return;
        if (SystemClock.elapsedRealtime() >= pairingDeadline) {
            endPairing("This code expired. Get a new code.", true);
            return;
        }
        final int current = generation;
        final String proof = pending;
        polling = true;
        worker.execute(() -> {
            String state;
            try { state = TvApi.request("device", "PUT", proof, null, null).getString("state"); }
            catch (TvApi.Failure failure) {
                state = failure.status == 401 ? "expired" : failure.status == 404 ? "disabled"
                        : failure.status == 429 ? "slow_down" : "offline";
            } catch (Exception failure) { state = "offline"; }
            final String result = state;
            handler.post(() -> {
                if (generation != current || !proof.equals(pending) || isFinishing()) return;
                polling = false;
                if (!foreground) return;
                switch (result) {
                    case "paired":
                        token = sessionCandidate;
                        temporarySession = true;
                        resetPairing();
                        status = "Connected to AskGogo.";
                        showAsk();
                        break;
                    case "denied": endPairing("Pairing was declined on your phone.", false); break;
                    case "cancelled": endPairing("Pairing was cancelled.", false); break;
                    case "expired": endPairing("This code expired. Get a new code.", true); break;
                    case "disabled": endPairing("AskGogo TV pairing is unavailable on this server.", true); break;
                    default:
                        String nextStatus = result.equals("offline") ? "Connection interrupted. Retrying…"
                                : "Waiting for approval on your phone…";
                        if (pairingStatus != null && !nextStatus.equals(status)) pairingStatus.setText(nextStatus);
                        status = nextStatus;
                        schedulePoll(result.equals("pending") ? 4000 : 8000);
                }
            });
        });
    }

    private void endPairing(String message, boolean revoke) {
        if (revoke) revokeQuietly(sessionCandidate);
        resetPairing();
        status = message;
        showPair();
    }

    private void cancelPairing() {
        lock();
        showProfiles();
    }

    private void resetPairing() {
        handler.removeCallbacks(poll);
        polling = false;
        pending = null;
        sessionCandidate = null;
        pairingCode = null;
        pairingQr = null;
        pairingStatus = null;
    }

    private void revokeQuietly(String proof) {
        if (proof == null) return;
        worker.execute(() -> {
            try { TvApi.request("device", "DELETE", proof, null, null); }
            catch (Exception ignored) { /* The server expiry still applies. */ }
        });
    }

    private void showAsk() {
        LinearLayout column = screen(Page.ASK, "AskGogo");
        if (capture != null) {
            addAction(column, "Stop recording", "Up to 20 seconds", () -> capture.stop());
            focus(column, column.getChildCount() - 1);
            return;
        }
        if (audio != null) {
            int first = column.getChildCount();
            addAction(column, "Transcribe recording", "Send this clip to AskGogo for transcription", this::transcribe);
            addAction(column, "Discard recording", "Delete this clip", () -> { clearAudio(); showAsk(); });
            focus(column, first);
            return;
        }
        question = new EditText(this);
        question.setSingleLine();
        question.setSaveEnabled(false);
        question.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(1000)});
        question.setImeOptions(EditorInfo.IME_ACTION_DONE | EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING);
        question.setId(View.generateViewId());
        question.setOnEditorActionListener((field, action, event) -> {
            if (action != EditorInfo.IME_ACTION_DONE) return false;
            InputMethodManager keyboard = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
            if (keyboard != null) keyboard.hideSoftInputFromWindow(field.getWindowToken(), 0);
            ask();
            return true;
        });
        question.setHint("Ask a question");
        question.setText(draft);
        column.addView(question, new LinearLayout.LayoutParams(-1, -2));
        int first = column.getChildCount();
        if (!answer.isEmpty()) column.addView(title(answer, 20, 0xFFE5F1FA));
        if (!answer.isEmpty()) first++;
        addAction(column, "Today’s calendar", "AskGogo reads the paired account’s calendar", () -> {
            if (question != null) question.setText("Show my calendar today");
            ask();
        });
        addAction(column, "Send to AskGogo", "Read-only questions", this::ask);
        View send = column.getChildAt(column.getChildCount() - 1);
        send.setId(View.generateViewId());
        question.setNextFocusDownId(send.getId());
        if (profiles.enabled(slot, "voice", false)) {
            addAction(column, "Record a question", "Select or hold the center button here to start",
                    this::startRecording);
            View record = column.getChildAt(column.getChildCount() - 1);
            record.setLongClickable(true);
            record.setOnLongClickListener(v -> { startRecording(); return true; });
            addAction(column, wakeArmed ? "Stop Hey Gogo" : "Listen for Hey Gogo",
                    "On-device wake for up to two minutes", this::toggleWake);
        }
        if (!answer.isEmpty() && profiles.enabled(slot, "playback", false))
            addAction(column, "Read answer aloud", "Uses an installed offline voice", this::speak);
        focus(column, first);
    }

    private void rememberDraft() {
        if (question != null) draft = question.getText().toString().trim();
    }

    private void ask() {
        rememberDraft();
        if (busy || token == null || draft.isEmpty()) return;
        wakeArmed = false;
        stopWake();
        stopPlayback();
        String proof = token;
        String text = draft;
        if (profiles.enabled(slot, "localCommands", true)) {
            String description = GogoTvControls.description(text);
            if (description != null) {
                int current = generation;
                new AlertDialog.Builder(this).setTitle("Control this TV?").setMessage(description)
                    .setNegativeButton("Cancel", null)
                    .setPositiveButton("Confirm", (dialog, choice) -> {
                        if (generation != current || !foreground) return;
                        boolean done = false;
                        try { done = GogoTvControls.execute(this, text); }
                        catch (SecurityException ignored) {}
                        status = done ? "" : "This TV control is unavailable.";
                        draft = "";
                        showAsk();
                    }).show();
                return;
            }
        }
        status = "Asking AskGogo…";
        showAsk();
        run(() -> TvApi.request("ask", "POST", proof, "application/json",
                new JSONObject().put("text", text).toString().getBytes(StandardCharsets.UTF_8)), result -> {
            answer = result.getString("text");
            status = "";
            draft = "";
            showAsk();
        });
    }

    private boolean canRecord() {
        return foreground && page == Page.ASK && token != null && !busy && capture == null && audio == null &&
                profiles.enabled(slot, "voice", false);
    }

    private void startRecording() {
        if (!canRecord()) return;
        rememberDraft();
        wakeArmed = false;
        stopWake();
        if (speaker != null && speaker.isSpeaking()) {
            stopPlayback();
            status = "Playback stopped. Select Record again.";
            showAsk();
            return;
        }
        if (SystemClock.elapsedRealtime() < silentUntil) {
            status = "Playback just ended. Select Record again in a moment.";
            showAsk();
            return;
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, 7);
            return;
        }
        final VoiceCapture recording = new VoiceCapture();
        final int current = generation;
        capture = recording;
        status = "Recording…";
        showAsk();
        microphone.execute(() -> {
            byte[] recorded = null;
            try { recorded = recording.capture(); } catch (RuntimeException ignored) {}
            byte[] bytes = recorded;
            handler.post(() -> {
                if (generation != current || capture != recording || !foreground) {
                    if (bytes != null) Arrays.fill(bytes, (byte) 0);
                    return;
                }
                capture = null;
                audio = bytes;
                status = bytes == null ? "No usable audio. Check the TV microphone or use typing." : "Recording ready";
                showAsk();
            });
        });
    }

    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(request, permissions, grants);
        if (request == 7 && page == Page.ASK && token != null) {
            status = grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED ?
                    "Microphone enabled. Select Record when ready." : "Microphone permission was declined.";
            showAsk();
        }
    }

    private void transcribe() {
        if (busy || audio == null || token == null) return;
        byte[] clip = audio;
        audio = null;
        String proof = token;
        status = "Transcribing…";
        showAsk();
        run(() -> {
            try { return TvApi.request("ask", "POST", proof, "audio/wav", clip); }
            finally { Arrays.fill(clip, (byte) 0); }
        }, result -> {
            draft = result.getString("transcript");
            status = draft.isEmpty() ? "No speech detected." : "Review the transcript before sending.";
            showAsk();
            if (question != null) findViewById(question.getNextFocusDownId()).requestFocus();
        });
    }

    private void toggleWake() {
        if (wakeArmed) {
            wakeArmed = false;
            stopWake();
            status = "";
            showAsk();
            return;
        }
        if (!canRecord()) return;
        rememberDraft();
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, 7);
            return;
        }
        stopPlayback();
        wakeArmed = true;
        status = "Starting on-device wake…";
        showAsk();
        handler.postDelayed(this::listenForWake, 600);
    }

    private void listenForWake() {
        if (!wakeArmed || !canRecord() || wake != null) return;
        if (SystemClock.elapsedRealtime() < silentUntil || speaker != null && speaker.isSpeaking()) {
            handler.postDelayed(this::listenForWake, 800);
            return;
        }
        WakeListener listener = new WakeListener();
        wake = listener;
        microphone.execute(() -> {
            boolean detected = false;
            boolean failed = false;
            try {
                detected = listener.listen(this, () -> handler.post(() -> {
                    if (wake == listener && foreground) {
                        rememberDraft();
                        status = "Listening locally for “Hey Gogo”";
                        showAsk();
                    }
                }));
            } catch (Exception | LinkageError unavailable) { failed = true; }
            final boolean heard = detected;
            final boolean unavailable = failed;
            handler.post(() -> {
                if (wake != listener || !foreground) return;
                stopWake();
                wakeArmed = false;
                if (heard) startRecording();
                else {
                    rememberDraft();
                    status = unavailable ? "On-device wake is unavailable. Select Record to speak." : "Wake listening ended.";
                    showAsk();
                }
            });
        });
    }

    private void stopWake() {
        WakeListener listener = wake;
        wake = null;
        if (listener != null) listener.stop();
    }

    private void speak() {
        if (!foreground || busy || capture != null || answer.isEmpty()) return;
        wakeArmed = false;
        stopWake();
        if (speaker == null) {
            final int current = generation;
            speaker = new TextToSpeech(this, result -> handler.post(() -> {
                if (speaker == null) return;
                speakerReady = result == TextToSpeech.SUCCESS;
                if (speakerReady) speaker.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String id) {}
                    @Override public void onDone(String id) { delayMicrophone(); }
                    @Override public void onError(String id) { delayMicrophone(); }
                    @Override public void onStop(String id, boolean interrupted) { delayMicrophone(); }
                });
                if (current == generation && foreground && page == Page.ASK) speakReady();
            }));
        } else speakReady();
    }

    private void speakReady() {
        if (speakerReady && speaker.getVoices() != null) {
            for (android.speech.tts.Voice voice : speaker.getVoices()) {
                if (!voice.isNetworkConnectionRequired() && voice.getLocale().getLanguage().equals("en") &&
                        !voice.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) &&
                        speaker.setVoice(voice) == TextToSpeech.SUCCESS) {
                    if (speaker.speak(answer, TextToSpeech.QUEUE_FLUSH, null, "gogo-answer") == TextToSpeech.SUCCESS) {
                        silentUntil = SystemClock.elapsedRealtime() + 1000;
                        return;
                    }
                }
            }
        }
        status = "No installed offline speech voice.";
        showAsk();
    }

    private void stopPlayback() {
        if (speaker != null && speaker.isSpeaking()) {
            speaker.stop();
            silentUntil = SystemClock.elapsedRealtime() + 650;
        }
    }

    private void delayMicrophone() {
        handler.post(() -> silentUntil = Math.max(silentUntil, SystemClock.elapsedRealtime() + 650));
    }

    private void showControls() {
        LinearLayout column = screen(Page.CONTROLS, "TV controls");
        int first = column.getChildCount();
        AudioManager manager = (AudioManager) getSystemService(AUDIO_SERVICE);
        if (manager != null && !manager.isVolumeFixed()) {
            addAction(column, "Volume up", "Raise media volume one step",
                    () -> volume(manager, AudioManager.ADJUST_RAISE));
            addAction(column, "Volume down", "Lower media volume one step",
                    () -> volume(manager, AudioManager.ADJUST_LOWER));
            addAction(column, "Mute or unmute", "Toggle media mute",
                    () -> volume(manager, AudioManager.ADJUST_TOGGLE_MUTE));
        }
        if (profiles.enabled(slot, "couch", true))
            addAction(column, "Couch TV remote", "Open the existing paired remote app", this::openCouchRemote);
        addAction(column, "Back to dashboard", "Return to Gogo TV", this::showHub);
        focus(column, first);
    }

    private void volume(AudioManager manager, int direction) {
        try { manager.adjustStreamVolume(AudioManager.STREAM_MUSIC, direction, AudioManager.FLAG_SHOW_UI); }
        catch (SecurityException error) {
            status = "Use your physical remote to adjust the TV volume.";
            showControls();
        }
    }

    private void showSettings() {
        LinearLayout column = screen(Page.SETTINGS, "Settings  ·  " + profileName(slot));
        int first = column.getChildCount();
        toggle(column, "Markets", "markets", true);
        toggle(column, "Couch TV remote", "couch", true);
        if (slot != 0 && token != null) {
            toggle(column, "AskGogo", "ask", true);
            toggle(column, "Local TV commands", "localCommands", true);
            toggle(column, "Microphone", "voice", false);
            toggle(column, "Offline reply playback", "playback", false);
            if (temporarySession)
                addAction(column, "Save this profile", "Use a private PIN to reopen this TV session until it expires.",
                        () -> pinDialog(true));
            addAction(column, "Unpair AskGogo", "Revoke this profile’s device credential", () ->
                new AlertDialog.Builder(this).setTitle("Unpair this profile?")
                    .setNegativeButton("Cancel", null)
                    .setPositiveButton("Unpair", (dialog, which) -> unpair()).show());
        }
        focus(column, first);
    }

    private void toggle(LinearLayout column, String label, String key, boolean initial) {
        int index = column.getChildCount();
        addAction(column, label, profiles.enabled(slot, key, initial) ? "On" : "Off", () -> {
            profiles.toggle(slot, key, initial);
            showSettings();
            View replacement = ((ScrollView) root.getChildAt(0)).getChildAt(0);
            focus((LinearLayout) replacement, index);
        });
    }

    private void unpair() {
        if (token == null) return;
        String proof = token;
        final int selected = slot;
        run(() -> {
            JSONObject result = TvApi.request("device", "DELETE", proof, null, null);
            profiles.forget(selected);
            return result;
        }, result -> { lock(); status = "TV access revoked."; showHub(); });
    }

    private void focus(LinearLayout column, int index) {
        View child = column.getChildAt(index);
        if (child != null) child.requestFocus();
    }

    private interface Operation { JSONObject perform() throws Exception; }
    private interface Completion { void accept(JSONObject value) throws Exception; }

    private void run(Operation operation, Completion complete) {
        if (busy) return;
        busy = true;
        final int current = generation;
        worker.execute(() -> {
            if (generation != current) return;
            JSONObject result = null;
            int error = 0;
            try { result = operation.perform(); }
            catch (TvApi.Failure failure) { error = failure.status; }
            catch (Exception failure) { error = 503; }
            final JSONObject response = result;
            final int code = error;
            handler.post(() -> {
                if (generation != current || isFinishing()) return;
                busy = false;
                if (code == 401) {
                    if (token != null) profiles.forget(slot);
                    resetPairing();
                    temporarySession = false;
                    token = null;
                    draft = "";
                    answer = "";
                    status = "TV access expired or was revoked. Pair again.";
                    showPair();
                    return;
                }
                if (code != 0) {
                    status = code == 429 ? "Wait a moment and try again." : code == 426 ?
                            "Update the Gogo TV companion to pair." : code == 404 ?
                            "AskGogo TV pairing is disabled on this server." : "AskGogo is temporarily unavailable. Try again.";
                    redraw();
                    return;
                }
                try { complete.accept(response); }
                catch (Exception failure) { status = "Could not complete the request."; redraw(); }
            });
        });
    }

    private void redraw() {
        if (page == Page.PAIR) showPair();
        else if (page == Page.ASK) showAsk();
        else if (page == Page.SETTINGS) showSettings();
        else if (page == Page.PROFILES) showProfiles();
        else showHub();
    }

    @Override public void onBackPressed() {
        if (page == Page.HOME && !marketsOpen()) {
            super.onBackPressed();
            return;
        }
        if (page == Page.PAIR) {
            cancelPairing();
            return;
        }
        if (busy) {
            lock();
        } else if (page == Page.PAIR || page == Page.PROFILES) {
            lock();
        }
        status = "";
        showHub();
    }
}
