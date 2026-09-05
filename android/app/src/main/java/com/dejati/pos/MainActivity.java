package com.dejati.pos;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(BluetoothSerialPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
