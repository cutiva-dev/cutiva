plugins {
    id("com.android.library")
}

android {
    namespace = "dev.cutiva.engine.reframe"
    compileSdk = 36

    defaultConfig {
        minSdk = 24
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    // CutivaException and the plan types.
    api(project(":engine"))
    // Apache-2.0. MediaPipe Face Landmarker, the web's face detector (same model and hash).
    implementation("com.google.mediapipe:tasks-vision:1.1.1")
    // Apache-2.0. Decodes frames at a few per second, scaled on the GPU.
    implementation("androidx.media3:media3-inspector-frame:1.11.1")
    implementation("androidx.media3:media3-effect:1.11.1")
    implementation("androidx.media3:media3-common:1.11.1")

    // Test only, never shipped (see the engine module).
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20250517")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
}
