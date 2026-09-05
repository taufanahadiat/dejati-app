package com.dejati.pos;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.Intent;
import android.os.Build;
import android.util.Base64;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.IOException;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.util.Set;
import java.util.UUID;

@CapacitorPlugin(
    name = "BluetoothSerial",
    permissions = {
        @Permission(alias = "bluetooth", strings = {
            Manifest.permission.BLUETOOTH_CONNECT,
            Manifest.permission.BLUETOOTH_SCAN
        })
    }
)
public class BluetoothSerialPlugin extends Plugin {
    private static final String TAG = "BluetoothSerial";
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private final Object connectionLock = new Object();
    private BluetoothSocket socket;
    private OutputStream output;
    private String connectedAddress;

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || getPermissionState("bluetooth") == PermissionState.GRANTED) {
            JSObject result = new JSObject();
            result.put("granted", true);
            call.resolve(result);
            return;
        }
        requestPermissionForAlias("bluetooth", call, "bluetoothPermissionCallback");
    }

    @PermissionCallback
    private void bluetoothPermissionCallback(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", getPermissionState("bluetooth") == PermissionState.GRANTED);
        call.resolve(result);
    }

    @PluginMethod
    public void isEnabled(PluginCall call) {
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) {
            call.reject("Perangkat ini tidak mendukung Bluetooth.");
            return;
        }
        JSObject result = new JSObject();
        result.put("enabled", adapter.isEnabled());
        call.resolve(result);
    }

    @PluginMethod
    public void enable(PluginCall call) {
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) {
            call.reject("Perangkat ini tidak mendukung Bluetooth.");
            return;
        }
        if (adapter.isEnabled()) {
            call.resolve();
            return;
        }
        startActivityForResult(call, new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE), "enableResult");
    }

    @Override
    protected void handleOnActivityResult(int requestCode, int resultCode, Intent data) {
        super.handleOnActivityResult(requestCode, resultCode, data);
        PluginCall savedCall = getSavedCall();
        if (savedCall == null) return;
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter != null && adapter.isEnabled()) savedCall.resolve();
        else savedCall.reject("Bluetooth tidak diaktifkan.");
    }

    @PluginMethod
    public void listPairedDevices(PluginCall call) {
        BluetoothAdapter adapter = adapterOrReject(call);
        if (adapter == null) return;
        if (!adapter.isEnabled()) {
            call.reject("Bluetooth belum aktif.");
            return;
        }
        JSArray devices = new JSArray();
        Set<BluetoothDevice> paired = adapter.getBondedDevices();
        for (BluetoothDevice device : paired) {
            JSObject item = new JSObject();
            item.put("name", device.getName());
            item.put("address", device.getAddress());
            devices.put(item);
        }
        JSObject result = new JSObject();
        result.put("devices", devices);
        call.resolve(result);
    }

    @PluginMethod
    public void connect(PluginCall call) {
        String address = call.getString("address");
        if (address == null || address.isEmpty()) {
            call.reject("Alamat Bluetooth printer tidak tersedia.");
            return;
        }
        BluetoothAdapter adapter = adapterOrReject(call);
        if (adapter == null) return;
        new Thread(() -> {
            try {
                adapter.cancelDiscovery();
                BluetoothDevice device = adapter.getRemoteDevice(address);
                synchronized (connectionLock) {
                    if (socket != null && socket.isConnected() && address.equalsIgnoreCase(connectedAddress)) {
                        Log.d(TAG, "Reusing existing RFCOMM connection for " + address);
                        call.resolve();
                        return;
                    }
                    closeConnection();
                }
                BluetoothSocket nextSocket = connectWithFallbacks(device);
                synchronized (connectionLock) {
                    socket = nextSocket;
                    output = nextSocket.getOutputStream();
                    connectedAddress = address;
                }
                call.resolve();
            } catch (Exception error) {
                Log.e(TAG, "Bluetooth connect failed for " + address, error);
                call.reject("Tidak dapat terhubung ke printer: " + error.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void write(PluginCall call) {
        String data = call.getString("data");
        if (data == null) {
            call.reject("Data cetak tidak tersedia.");
            return;
        }
        new Thread(() -> {
            try {
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                synchronized (connectionLock) {
                    if (output == null) throw new IOException("Printer belum terhubung.");
                    output.write(bytes);
                    output.flush();
                }
                call.resolve();
            } catch (Exception error) {
                Log.e(TAG, "Bluetooth write failed", error);
                call.reject("Tidak dapat mengirim data cetak: " + error.getMessage());
            }
        }).start();
    }

    @Override
    protected void handleOnDestroy() {
        synchronized (connectionLock) {
            closeConnection();
        }
        super.handleOnDestroy();
    }

    private BluetoothAdapter adapterOrReject(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && getPermissionState("bluetooth") != PermissionState.GRANTED) {
            call.reject("Izin Bluetooth belum diberikan.");
            return null;
        }
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) call.reject("Perangkat ini tidak mendukung Bluetooth.");
        return adapter;
    }

    private void closeConnection() {
        try {
            if (output != null) output.close();
        } catch (IOException ignored) {
        }
        try {
            if (socket != null) socket.close();
        } catch (IOException ignored) {
        }
        output = null;
        socket = null;
        connectedAddress = null;
    }

    private BluetoothSocket connectWithFallbacks(BluetoothDevice device) throws Exception {
        Exception lastError = null;
        try {
            return connectSocket("secure RFCOMM", device.createRfcommSocketToServiceRecord(SPP_UUID), device);
        } catch (Exception error) {
            lastError = error;
            Log.w(TAG, "Secure RFCOMM connect failed for " + device.getAddress(), error);
        }

        try {
            return connectSocket("insecure RFCOMM", device.createInsecureRfcommSocketToServiceRecord(SPP_UUID), device);
        } catch (Exception error) {
            lastError = error;
            Log.w(TAG, "Insecure RFCOMM connect failed for " + device.getAddress(), error);
        }

        try {
            Method method = device.getClass().getMethod("createRfcommSocket", int.class);
            BluetoothSocket fallbackSocket = (BluetoothSocket) method.invoke(device, 1);
            return connectSocket("RFCOMM channel 1", fallbackSocket, device);
        } catch (Exception error) {
            Log.w(TAG, "Reflection RFCOMM connect failed for " + device.getAddress(), error);
            if (lastError != null) throw lastError;
            throw error;
        }
    }

    private BluetoothSocket connectSocket(String method, BluetoothSocket candidate, BluetoothDevice device) throws IOException {
        try {
            candidate.connect();
            Log.d(TAG, "Connected with " + method + " to " + device.getAddress());
            return candidate;
        } catch (IOException error) {
            try {
                candidate.close();
            } catch (IOException ignored) {
            }
            throw error;
        }
    }
}
