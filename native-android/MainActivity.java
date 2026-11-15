package com.pdfstudio.editorpro;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativePdfRendererPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
