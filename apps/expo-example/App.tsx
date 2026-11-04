import { reframeVideo, type ReframeEdit, type ReframeStage, type ReframeVideoResult, type TrackSegment } from "@cutiva/expo";
import { StatusBar } from "expo-status-bar";
import * as ImagePicker from "expo-image-picker";
import { useVideoPlayer, VideoView } from "expo-video";
import { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

const STAGE: Record<ReframeStage, string> = {
  model: "Downloading the face model (once)",
  video: "Finding faces",
  audio: "Listening for speech",
  export: "Exporting",
};

const seconds = (us: number) => `${(us / 1e6).toFixed(1)} s`;

export default function App() {
  const [source, setSource] = useState<string | null>(null);
  const [result, setResult] = useState<ReframeVideoResult | null>(null);
  const [progress, setProgress] = useState<{ ratio: number; stage: ReframeStage } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const player = useVideoPlayer(result?.uri ?? null, (p) => {
    p.loop = true;
    p.play();
  });

  async function run(uri: string, previous?: ReframeVideoResult, edits?: ReframeEdit[]) {
    setError(null);
    abort.current = new AbortController();
    const started = Date.now();
    try {
      const next = await reframeVideo(uri, {
        // A correction re-plans from the earlier analysis: no second analysis.
        ...(previous ? { analysis: previous.analysis, track: previous.track, edits } : {}),
        onProgress: (ratio, stage) => setProgress({ ratio, stage }),
        signal: abort.current.signal,
      });
      console.log(`reframed in ${((Date.now() - started) / 1000).toFixed(1)} s`);
      setResult(next);
    } catch (e) {
      const err = e as { code?: string; message?: string };
      setError(`${err.code ?? "ERROR"}: ${err.message ?? String(e)}`);
    } finally {
      setProgress(null);
    }
  }

  async function pick() {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["videos"], quality: 1 });
    const uri = picked.assets?.[0]?.uri;
    if (picked.canceled || !uri) return;
    setSource(uri);
    setResult(null);
    await run(uri);
  }

  const name = (id: string) => result?.track.people.find((p) => p.id === id)?.label ?? id;
  const caption = (s: TrackSegment) =>
    s.resolved === "wide" ? "Wide" : s.resolved === "split" ? `Split · ${(s.focus.length ? s.focus : s.speakers).map(name).join(" + ")}` : name(s.focus[0] ?? s.speakers[0] ?? "") || "Centre";
  const edit = (edits: ReframeEdit[]) => source && result && run(source, result, edits);

  return (
    <View style={styles.app}>
      <StatusBar style="light" />
      <Text style={styles.title}>Cutiva auto-reframe</Text>
      <Text style={styles.muted}>A landscape video in, a 9:16 video out that follows whoever talks. Everything runs on this phone.</Text>

      {progress ? (
        <View style={styles.card}>
          <Text style={styles.text}>{STAGE[progress.stage]}… {Math.round(progress.ratio * 100)}%</Text>
          <View style={styles.bar}>
            <View style={[styles.fill, { width: `${Math.round(progress.ratio * 100)}%` }]} />
          </View>
          <Pressable style={styles.button} onPress={() => abort.current?.abort()}>
            <Text style={styles.buttonText}>Cancel</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable style={[styles.button, styles.primary]} onPress={pick}>
          <Text style={styles.primaryText}>{result ? "Pick another video" : "Pick a video"}</Text>
        </Pressable>
      )}
      {error && <Text style={styles.error}>{error}</Text>}

      {result && (
        <ScrollView style={styles.result} contentContainerStyle={{ gap: 12, paddingBottom: 32 }}>
          <VideoView player={player} style={styles.video} contentFit="contain" nativeControls />
          <Text style={styles.muted}>
            {result.track.people.length} people · {result.track.segments.length} shots{result.passthrough ? " · already vertical" : ""}
          </Text>
          {result.track.segments.map((s) => (
            <View key={s.id} style={styles.card}>
              <Text style={styles.text}>
                {seconds(s.startUs)}–{seconds(s.endUs)} · {caption(s)}
                {s.locked ? " (locked)" : ""}
              </Text>
              <View style={styles.row}>
                {result.track.people
                  .filter((p) => p.kind === "face")
                  .map((p) => (
                    <Pressable key={p.id} style={styles.chip} onPress={() => edit([{ type: "segment", segmentId: s.id, layout: "single", focus: [p.id] }])}>
                      <Text style={styles.chipText}>{p.label}</Text>
                    </Pressable>
                  ))}
                <Pressable style={styles.chip} onPress={() => edit([{ type: "segment", segmentId: s.id, layout: "split" }])}>
                  <Text style={styles.chipText}>Split</Text>
                </Pressable>
                <Pressable style={styles.chip} onPress={() => edit([{ type: "segment", segmentId: s.id, layout: "wide" }])}>
                  <Text style={styles.chipText}>Wide</Text>
                </Pressable>
                {s.locked && (
                  <Pressable style={styles.chip} onPress={() => edit([{ type: "reset", segmentId: s.id }])}>
                    <Text style={styles.chipText}>Reset</Text>
                  </Pressable>
                )}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

// Cutiva brand: background #0E0F12, raised #17191E, lines #2A2D33, text #EDEEF0, muted #9BA1AC, accent #FF6A3D.
const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: "#0E0F12", paddingTop: 64, paddingHorizontal: 16, gap: 12 },
  title: { color: "#EDEEF0", fontSize: 22, fontWeight: "600" },
  text: { color: "#EDEEF0", fontSize: 15 },
  muted: { color: "#9BA1AC", fontSize: 14 },
  error: { color: "#FF6A3D", fontSize: 14 },
  card: { backgroundColor: "#17191E", borderColor: "#2A2D33", borderWidth: 1, borderRadius: 10, padding: 12, gap: 10 },
  bar: { height: 6, backgroundColor: "#2A2D33", borderRadius: 3, overflow: "hidden" },
  fill: { height: 6, backgroundColor: "#FF6A3D" },
  button: { borderColor: "#2A2D33", borderWidth: 1, borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  buttonText: { color: "#EDEEF0", fontSize: 15 },
  primary: { backgroundColor: "#FF6A3D", borderColor: "#FF6A3D" },
  primaryText: { color: "#14161A", fontSize: 16, fontWeight: "600" },
  result: { flex: 1 },
  video: { width: "100%", aspectRatio: 9 / 16, backgroundColor: "#000", borderRadius: 10 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderColor: "#2A2D33", borderWidth: 1, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  chipText: { color: "#EDEEF0", fontSize: 13 },
});
