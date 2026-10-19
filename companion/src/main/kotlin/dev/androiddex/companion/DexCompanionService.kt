package dev.androiddex.companion

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.BatteryManager
import android.os.Build
import android.os.IBinder
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit
import kotlin.math.min
import kotlin.math.pow

/**
 * Reference foreground service for the Android DEX companion (protocol v2).
 *
 * This is a protocol skeleton, not a finished Play-ready app. It shows the
 * lifecycle, reconnect policy and framing; device-specific integrations
 * (MediaProjection, Telecom, notification actions) are marked TODO and must be
 * implemented against the roles the user granted. See doc/COMPANION_PROTOCOL.md.
 */
class DexCompanionService : Service() {

    private val client = OkHttpClient.Builder()
        .pingInterval(20, TimeUnit.SECONDS)
        .build()

    private var socket: WebSocket? = null
    private var attempt = 0
    private var stopped = false

    override fun onCreate() {
        super.onCreate()
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIFICATION_ID, buildNotification("Connected to Android DEX"))
        if (socket == null) connect()
        return START_STICKY
    }

    private fun createChannel() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Bridge connection", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Keeps the Android DEX bridge connection alive"
                setShowBadge(false)
            },
        )
    }

    private fun buildNotification(text: String): Notification =
        Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("Android DEX")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setOngoing(true)
            .build()

    private fun connect() {
        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val host = prefs.getString(KEY_HOST, null) ?: return
        val token = prefs.getString(KEY_TOKEN, null) ?: return
        val url = "ws://$host${DexProtocol.PATH_WS}?token=$token"
        val request = Request.Builder().url(url).build()
        stopped = false
        socket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                attempt = 0
                val hello = ClientFrame(
                    type = "hello",
                    id = "hello_${System.currentTimeMillis()}",
                    action = "hello",
                    payload = DexProtocol.json.encodeToJsonElement(
                        Capabilities.serializer(),
                        Capabilities(
                            device = DeviceInfo(Build.MODEL, Build.VERSION.RELEASE, Build.VERSION.SDK_INT),
                            capabilities = listOf("clipboard", "files", "notifications", "telemetry"),
                            protocol = DexProtocol.VERSION,
                        ),
                    ),
                )
                webSocket.send(DexProtocol.json.encodeToString(ClientFrame.serializer(), hello))
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val frame = runCatching { DexProtocol.json.decodeFromString(ServerFrame.serializer(), text) }.getOrNull() ?: return
                when (frame) {
                    is ServerFrame.Hello -> sendTelemetry(webSocket)
                    is ServerFrame.Result -> if (!frame.ok) { /* surface error */ }
                    is ServerFrame.Failure -> if (frame.payload.code == "unauthorized") { stopSelf() }
                    else -> Unit
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                socket = null
                scheduleReconnect()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                socket = null
                scheduleReconnect()
            }
        })
    }

    /** Exponential backoff with jitter, mirroring the bridge policy. */
    private fun scheduleReconnect() {
        if (stopped) return
        attempt += 1
        val delay = min(30_000.0, 600 * 1.8.pow(attempt - 1)).toLong()
        android.os.Handler(mainLooper).postDelayed({ if (!stopped) connect() }, delay)
    }

    private fun sendTelemetry(webSocket: WebSocket) {
        val battery = getSystemService(BatteryManager::class.java)
        val level = battery.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY).toDouble()
        val charging = battery.isCharging
        val telemetry = Telemetry(BatteryTelemetry(level, charging))
        val frame = ClientFrame(
            type = "telemetry",
            id = "telemetry_${System.currentTimeMillis()}",
            action = "telemetry",
            payload = DexProtocol.json.encodeToJsonElement(Telemetry.serializer(), telemetry),
        )
        webSocket.send(DexProtocol.json.encodeToString(ClientFrame.serializer(), frame))
    }

    override fun onDestroy() {
        stopped = true
        socket?.close(1000, "service stopped")
        socket = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val CHANNEL_ID = "dex_bridge"
        const val NOTIFICATION_ID = 41
        const val PREFS = "dex_pairing"
        const val KEY_HOST = "host"
        const val KEY_TOKEN = "token"
        const val KEY_FINGERPRINT = "fingerprint"

        fun start(context: Context) {
            val intent = Intent(context, DexCompanionService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
            else context.startService(intent)
        }
    }
}

