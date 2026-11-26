package in.askgogo.tvhub;

import android.annotation.SuppressLint;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.media.audiofx.AcousticEchoCanceler;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;

final class VoiceCapture {
    static final int SAMPLE_RATE = 16000;
    private static final int MAX_BYTES = SAMPLE_RATE * 2 * 20;
    private volatile boolean stopped;

    void stop() { stopped = true; }

    @SuppressLint("MissingPermission")
    static AudioRecord newRecorder(int source) {
        int minimum = AudioRecord.getMinBufferSize(SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        if (minimum <= 0) return null;
        return new AudioRecord(source, SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(minimum, 3200));
    }

    byte[] capture() {
        if (stopped) return null;
        AudioRecord recorder = newRecorder(MediaRecorder.AudioSource.VOICE_COMMUNICATION);
        if (recorder == null) return null;
        AcousticEchoCanceler echo = null;
        ByteArrayOutputStream pcm = new ByteArrayOutputStream();
        try {
            if (recorder.getState() != AudioRecord.STATE_INITIALIZED || stopped) return null;
            if (AcousticEchoCanceler.isAvailable()) {
                try {
                    echo = AcousticEchoCanceler.create(recorder.getAudioSessionId());
                    if (echo != null) echo.setEnabled(true);
                } catch (RuntimeException ignored) {
                    // Reply playback is separately stopped and time-gated by the activity.
                }
            }
            recorder.startRecording();
            byte[] buffer = new byte[1600];
            while (!stopped && pcm.size() < MAX_BYTES) {
                int count = recorder.read(buffer, 0, Math.min(buffer.length, MAX_BYTES - pcm.size()));
                if (count < 0) return null;
                pcm.write(buffer, 0, count);
            }
        } finally {
            if (recorder.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) recorder.stop();
            if (echo != null) echo.release();
            recorder.release();
        }
        if (pcm.size() < 3200) return null;
        ByteBuffer wav = ByteBuffer.allocate(44 + pcm.size()).order(ByteOrder.LITTLE_ENDIAN);
        tag(wav, "RIFF").putInt(36 + pcm.size());
        tag(wav, "WAVE");
        tag(wav, "fmt ").putInt(16).putShort((short) 1).putShort((short) 1)
                .putInt(SAMPLE_RATE).putInt(SAMPLE_RATE * 2).putShort((short) 2).putShort((short) 16);
        tag(wav, "data").putInt(pcm.size()).put(pcm.toByteArray());
        return wav.array();
    }

    private static ByteBuffer tag(ByteBuffer buffer, String tag) {
        return buffer.put(tag.getBytes(StandardCharsets.US_ASCII));
    }
}
