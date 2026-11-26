
package in.askgogo.tvhub;

import android.graphics.Bitmap;
import android.graphics.Color;
import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.WriterException;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.QRCodeWriter;
import java.util.Collections;

final class PairingQr {
    private PairingQr() {}

    static Bitmap create(String url, int size) {
        try {
            BitMatrix matrix = new QRCodeWriter().encode(url, BarcodeFormat.QR_CODE, size, size,
                    Collections.singletonMap(EncodeHintType.MARGIN, 4));
            int[] pixels = new int[size * size];
            for (int y = 0; y < size; y++) {
                for (int x = 0; x < size; x++) {
                    pixels[y * size + x] = matrix.get(x, y) ? Color.BLACK : Color.WHITE;
                }
            }
            return Bitmap.createBitmap(pixels, size, size, Bitmap.Config.ARGB_8888);
        } catch (WriterException error) {
            return null;
        }
    }
}
