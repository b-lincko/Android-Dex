package dev.androiddex.companion

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder

/**
 * Wire types for the Android DEX companion protocol, v2.
 * See doc/COMPANION_PROTOCOL.md. Unknown fields must be ignored.
 */
object DexProtocol {
    const val VERSION = 2
    const val PATH_WS = "/ws"
    const val DEFAULT_PORT = 8787

    val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        explicitNulls = false
    }
}

@Serializable
data class PairRequest(
    val deviceName: String,
    val transport: String = "wifi",
)

@Serializable
data class PairResponse(
    val pairingId: String,
    val token: String,
    val code: String,
    val fingerprint: String,
    val qrPayload: String,
    val expiresAt: String? = null,
    val adbSteps: List<String> = emptyList(),
)

@Serializable
data class PairConfirm(
    val pairingId: String,
    val token: String,
    val code: String,
    val device: String,
    val fingerprint: String,
)

/** Strict parser for dex://pair payloads. Reject unknown versions. */
data class QrPayload(
    val host: String,
    val port: Int,
    val token: String,
    val code: String,
    val fingerprint: String,
    val transport: String,
    val deviceName: String?,
) {
    companion object {
        fun parse(raw: String): QrPayload {
            val uri = URI(raw)
            require(uri.scheme == "dex" && uri.host == "pair") { "not a dex pairing payload" }
            val query = uri.rawQuery.orEmpty().split('&').filter { it.contains('=') }
                .associate { pair ->
                    val (key, value) = pair.split('=', limit = 2)
                    URLDecoder.decode(key, "UTF-8") to URLDecoder.decode(value, "UTF-8")
                }
            require(query["v"] == DexProtocol.VERSION.toString()) { "unsupported protocol version" }
            require(query["fp"]?.startsWith("SHA256:") == true) { "missing pinned fingerprint" }
            return QrPayload(
                host = query.getValue("host"),
                port = query["port"]?.toIntOrNull() ?: DexProtocol.DEFAULT_PORT,
                token = query.getValue("token"),
                code = query.getValue("code"),
                fingerprint = query.getValue("fp"),
                transport = query["transport"] ?: "wifi",
                deviceName = query["device"],
            )
        }

        fun build(
            host: String, port: Int, token: String, code: String,
            fingerprint: String, transport: String, deviceName: String,
        ): String {
            fun enc(value: String) = URLEncoder.encode(value, "UTF-8")
            return "dex://pair?host=${enc(host)}&port=$port&token=${enc(token)}&code=$code" +
                "&fp=${enc(fingerprint)}&transport=$transport&device=${enc(deviceName)}&v=${DexProtocol.VERSION}"
        }
    }
}

@Serializable
sealed class ServerFrame {
    @Serializable @SerialName("hello")
    data class Hello(val payload: HelloPayload) : ServerFrame()

    @Serializable @SerialName("events")
    data class Events(val payload: EventsPayload) : ServerFrame()

    @Serializable @SerialName("pong")
    data class Pong(val payload: PongPayload) : ServerFrame()

    @Serializable @SerialName("result")
    data class Result(
        val id: String,
        val ok: Boolean,
        val payload: kotlinx.serialization.json.JsonElement? = null,
        val error: ProtocolError? = null,
    ) : ServerFrame()

    @Serializable @SerialName("error")
    data class Failure(val payload: ProtocolError) : ServerFrame()
}

@Serializable data class HelloPayload(
    val version: String,
    val commands: List<String> = emptyList(),
    val state: kotlinx.serialization.json.JsonElement? = null,
)

@Serializable data class EventsPayload(val events: List<DomainEvent> = emptyList())
@Serializable data class PongPayload(val ts: Long)
@Serializable data class ProtocolError(val code: String, val message: String)

@Serializable
data class DomainEvent(
    val type: String,
    val payload: kotlinx.serialization.json.JsonElement? = null,
)

@Serializable
data class ClientFrame(
    val type: String = "command",
    val id: String,
    val action: String,
    val payload: kotlinx.serialization.json.JsonElement? = null,
)

@Serializable data class Capabilities(
    val device: DeviceInfo,
    val capabilities: List<String>,
    val protocol: Int,
)

@Serializable data class DeviceInfo(val model: String, val android: String, val sdk: Int)

@Serializable data class ClipPayload(val kind: String, val text: String? = null, val dataUrl: String? = null)

@Serializable
data class Telemetry(
    val battery: BatteryTelemetry,
    val signal: SignalTelemetry? = null,
    val quality: QualityTelemetry? = null,
)

@Serializable data class BatteryTelemetry(val level: Double, val charging: Boolean, val temperature: Double? = null)
@Serializable data class SignalTelemetry(val rssi: Int?, val transport: String)
@Serializable data class QualityTelemetry(val fps: Int, val bitrateMbps: Double, val latencyMs: Double, val drops: Int = 0)

@Serializable
data class NotificationPayload(
    val id: String,
    val app: String,
    val title: String,
    val body: String,
    val ts: String,
    val actions: List<NotificationAction> = emptyList(),
)

@Serializable data class NotificationAction(val id: String, val label: String, val reply: Boolean = false)

@Serializable
data class IncomingCall(val id: String, val number: String, val name: String? = null, val video: Boolean = false)
