package in.askgogo.tvhub;

import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import javax.net.ssl.HttpsURLConnection;
import java.nio.charset.StandardCharsets;

final class TvApi {
    private TvApi() {}

    static JSONObject request(String path, String method, String token, String type, byte[] body)
            throws Exception {
        URL url = new URL(BuildConfig.ORIGIN + "/api/tv/" + path);
        HttpsURLConnection connection = (HttpsURLConnection) url.openConnection();
        try {
            connection.setRequestMethod(method);
            connection.setInstanceFollowRedirects(false);
            connection.setUseCaches(false);
            connection.setConnectTimeout(6000);
            connection.setReadTimeout(path.equals("device") ? 8000 : 45000);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("X-Gogo-TV", "2");
            if (token != null) connection.setRequestProperty("Authorization", "Bearer " + token);
            if (body != null) {
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", type);
                connection.setFixedLengthStreamingMode(body.length);
                try (OutputStream stream = connection.getOutputStream()) { stream.write(body); }
            }
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new Failure(status);
            try (InputStream stream = connection.getInputStream()) {
                ByteArrayOutputStream data = new ByteArrayOutputStream();
                byte[] buffer = new byte[2048];
                int count;
                while ((count = stream.read(buffer)) != -1) {
                    if (data.size() + count > 16384) throw new Failure(502);
                    data.write(buffer, 0, count);
                }
                return new JSONObject(new String(data.toByteArray(), StandardCharsets.UTF_8));
            }
        } finally {
            connection.disconnect();
        }
    }

    static final class Failure extends Exception {
        final int status;
        Failure(int status) { this.status = status; }
    }
}
