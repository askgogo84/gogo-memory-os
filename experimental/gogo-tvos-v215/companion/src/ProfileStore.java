package in.askgogo.tvhub;

import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.util.Arrays;
import javax.crypto.AEADBadTagException;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.Mac;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;

final class ProfileStore {
    private static final String KEY_ALIAS = "gogo-tv-profile-v1";
    private final SharedPreferences preferences;

    ProfileStore(SharedPreferences preferences) { this.preferences = preferences; }

    boolean paired(int slot) { return preferences.contains(slot + ":session"); }

    boolean enabled(int slot, String feature, boolean initial) {
        return preferences.getBoolean(slot + ":" + feature, initial);
    }

    void toggle(int slot, String feature, boolean initial) {
        preferences.edit().putBoolean(slot + ":" + feature, !enabled(slot, feature, initial)).apply();
    }

    void save(int slot, String pin, String token) throws Exception {
        if (!pin.matches("[0-9]{6,12}") || paired(slot) || !token.matches("gtv_[A-Za-z0-9_-]{43}"))
            throw new IllegalArgumentException();
        byte[] salt = new byte[16];
        new SecureRandom().nextBytes(salt);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key(pin, salt));
        cipher.updateAAD(new byte[]{(byte) slot});
        byte[] encrypted = cipher.doFinal(token.getBytes(StandardCharsets.US_ASCII));
        byte[] envelope = ByteBuffer.allocate(16 + 12 + encrypted.length)
                .put(salt).put(cipher.getIV()).put(encrypted).array();
        if (!preferences.edit().putString(slot + ":session", Base64.encodeToString(envelope, Base64.NO_WRAP))
                .remove(slot + ":failures").remove(slot + ":retryAt").commit()) throw new IllegalStateException();
    }

    long secondsUntilUnlock(int slot) {
        long remaining = preferences.getLong(slot + ":retryAt", 0) - System.currentTimeMillis();
        return Math.max(0, (remaining + 999) / 1000);
    }

    String unlock(int slot, String pin) throws Exception {
        if (!pin.matches("[0-9]{6,12}") || secondsUntilUnlock(slot) > 0) return null;
        String encoded = preferences.getString(slot + ":session", null);
        if (encoded == null) return null;
        byte[] envelope = Base64.decode(encoded, Base64.NO_WRAP);
        byte[] salt = Arrays.copyOfRange(envelope, 0, 16);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(pin, salt), new GCMParameterSpec(128, envelope, 16, 12));
        cipher.updateAAD(new byte[]{(byte) slot});
        try {
            byte[] plaintext = cipher.doFinal(envelope, 28, envelope.length - 28);
            preferences.edit().remove(slot + ":failures").remove(slot + ":retryAt").commit();
            String token = new String(plaintext, StandardCharsets.US_ASCII);
            Arrays.fill(plaintext, (byte) 0);
            return token;
        } catch (AEADBadTagException e) {
            int failures = Math.min(12, preferences.getInt(slot + ":failures", 0) + 1);
            long retryAt = System.currentTimeMillis() + (failures >= 5 ? (1L << (failures - 5)) * 30000 : 0);
            preferences.edit().putInt(slot + ":failures", failures).putLong(slot + ":retryAt", retryAt).commit();
            return null;
        }
    }

    void forget(int slot) {
        preferences.edit().remove(slot + ":session").remove(slot + ":failures").remove(slot + ":retryAt").commit();
    }

    private static SecretKey key(String pin, byte[] salt) throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (!store.containsAlias(KEY_ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_HMAC_SHA256, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_SIGN).build());
            generator.generateKey();
        }
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init((SecretKey) store.getKey(KEY_ALIAS, null));
        byte[] digest = mac.doFinal(pin.getBytes(StandardCharsets.US_ASCII));
        PBEKeySpec spec = new PBEKeySpec(Base64.encodeToString(digest, Base64.NO_WRAP).toCharArray(), salt, 150_000, 256);
        try {
            byte[] key = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
            SecretKeySpec result = new SecretKeySpec(key, "AES");
            Arrays.fill(key, (byte) 0);
            return result;
        } finally {
            spec.clearPassword();
            Arrays.fill(digest, (byte) 0);
        }
    }
}
