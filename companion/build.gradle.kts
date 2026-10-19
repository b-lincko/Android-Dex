plugins {
    id("com.android.application") version "8.7.0"
    id("org.jetbrains.kotlin.android") version "2.0.21"
    id("org.jetbrains.kotlin.plugin.serialization") version "2.0.21"
}

android {
    namespace = "dev.androiddex.companion"
    compileSdk = 35
    defaultConfig {
        applicationId = "dev.androiddex.companion"
        minSdk = 28
        targetSdk = 35
        versionCode = 20000
        versionName = "2.0.0"
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    flavorDimensions += "distribution"
    productFlavors {
        create("play") { dimension = "distribution"; buildConfigField("boolean", "TELEPHONY", "false") }
        create("full") { dimension = "distribution"; buildConfigField("boolean", "TELEPHONY", "true") }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // Optional: encrypt the paired token at rest.
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
}
