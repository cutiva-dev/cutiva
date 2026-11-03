plugins {
    id("com.android.library")
}

android {
    namespace = "dev.cutiva.engine"
    compileSdk = 36

    defaultConfig {
        // Media3 Transformer's multi-asset export needs API 21+; 24 keeps MediaCodec behavior predictable.
        minSdk = 24
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    // Apache-2.0. Export uses the device's own H.264 and AAC encoders; no codec is bundled.
    implementation("androidx.media3:media3-transformer:1.11.1")
    implementation("androidx.media3:media3-effect:1.11.1")
    implementation("androidx.media3:media3-common:1.11.1")
    // Reads source formats (the AAC priming of inputs) the same way Transformer does.
    implementation("androidx.media3:media3-inspector:1.11.1")

    // Test only, never shipped. JUnit 4 is EPL-1.0; the Android test runner requires it.
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
}
