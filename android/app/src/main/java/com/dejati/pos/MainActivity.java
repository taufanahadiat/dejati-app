package com.dejati.pos;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(BluetoothSerialPlugin.class);
        registerPlugin(ReportFilePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
