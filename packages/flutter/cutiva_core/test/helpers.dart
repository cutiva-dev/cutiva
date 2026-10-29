import 'package:cutiva_core/cutiva_core.dart';

Asset video() =>
    Asset(id: 'ast_v', kind: AssetKind.video, name: 'v.mp4', uri: 'file://v.mp4', durationUs: 20000000, hasAudio: true);
Asset music() => Asset(id: 'ast_a', kind: AssetKind.audio, name: 'a.mp3', uri: 'file://a.mp3', durationUs: 60000000);

/// The error code [fn] throws: a CutivaError code, "OTHER" for anything else, "NONE" if it doesn't throw.
String codeOf(void Function() fn) {
  try {
    fn();
  } on CutivaError catch (e) {
    return e.code.value;
  } catch (_) {
    return 'OTHER';
  }
  return 'NONE';
}
