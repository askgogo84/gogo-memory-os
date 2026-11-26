package in.askgogo.tvhub;

import android.annotation.SuppressLint;
import android.content.Context;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.SystemClock;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import org.json.JSONObject;
import org.vosk.LibVosk;
import org.vosk.LogLevel;
import org.vosk.Model;
import org.vosk.Recognizer;

final class WakeListener {
    private static final String MODEL = "vosk-model-small-en-us-0.15";
    private static final String GRAMMAR = "[\"hey go go\", \"[unk]\"]";
    private static final int MAX_MODEL_BYTES = 80 * 1024 * 1024;
    private static final long WINDOW_MS = 120_000;
    private volatile boolean stopped;

    void stop() { stopped = true; }

    @SuppressLint("MissingPermission")
    boolean listen(Context context, Runnable ready) throws Exception {
        File modelDir = unpackModel(context);
        if (stopped || modelDir == null) return false;
        LibVosk.setLogLevel(LogLevel.WARNINGS);
        try (Model model = new Model(modelDir.getPath());
             Recognizer recognizer = new Recognizer(model, VoiceCapture.SAMPLE_RATE, GRAMMAR)) {
            if (stopped) return false;
            AudioRecord recorder = VoiceCapture.newRecorder(MediaRecorder.AudioSource.VOICE_RECOGNITION);
            if (recorder == null) throw new IOException("Microphone unavailable");
            try {
                if (recorder.getState() != AudioRecord.STATE_INITIALIZED)
                    throw new IOException("Microphone unavailable");
                recorder.startRecording();
                ready.run();
                long until = SystemClock.elapsedRealtime() + WINDOW_MS;
                byte[] buffer = new byte[3200];
                while (!stopped && SystemClock.elapsedRealtime() < until) {
                    int count = recorder.read(buffer, 0, buffer.length);
                    if (count < 0) throw new IOException("Microphone read failed");
                    if (count > 0 && recognizer.acceptWaveForm(buffer, count) &&
                            "hey go go".equals(new JSONObject(recognizer.getResult()).optString("text")))
                        return !stopped;
                }
                return false;
            } finally {
                if (recorder.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) recorder.stop();
                recorder.release();
            }
        }
    }

    private File unpackModel(Context context) throws IOException {
        File parent = new File(context.getNoBackupFilesDir(), "offline-speech");
        File directory = new File(parent, MODEL);
        File complete = new File(directory, ".ready-v1");
        if (complete.isFile()) return directory;
        String prefix = directory.getCanonicalPath() + File.separator;
        int total = 0;
        try (InputStream asset = context.getAssets().open(MODEL + ".zip");
             ZipInputStream zip = new ZipInputStream(asset)) {
            byte[] buffer = new byte[16384];
            ZipEntry entry;
            while (!stopped && (entry = zip.getNextEntry()) != null) {
                if (entry.isDirectory()) continue;
                File target = new File(parent, entry.getName()).getCanonicalFile();
                if (!target.getPath().startsWith(prefix) ||
                        !target.getParentFile().isDirectory() && !target.getParentFile().mkdirs())
                    throw new IOException("Invalid model archive");
                try (FileOutputStream output = new FileOutputStream(target)) {
                    int size;
                    while (!stopped && (size = zip.read(buffer)) != -1) {
                        total += size;
                        if (total > MAX_MODEL_BYTES) throw new IOException("Model exceeds size limit");
                        output.write(buffer, 0, size);
                    }
                }
            }
        }
        if (stopped) return null;
        if (!new File(directory, "am/final.mdl").isFile() || !complete.createNewFile())
            throw new IOException("Offline model did not unpack");
        return directory;
    }
}
