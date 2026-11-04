package org.ritmiq.tv;

import android.os.Bundle;
import android.view.View;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Sin el brillo de "fin de scroll" de Android: es trabajo extra de GPU
        // en aparatos modestos (onn. Google TV).
        getBridge().getWebView().setOverScrollMode(View.OVER_SCROLL_NEVER);
    }
}
