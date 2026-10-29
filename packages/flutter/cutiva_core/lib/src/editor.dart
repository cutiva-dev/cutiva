import 'dart:async';

import 'commands.dart';
import 'ids.dart';
import 'project.dart';
import 'time.dart';
import 'types.dart';

enum ChangeCause { command, undo, redo, load }

class EditorChange {
  final Project project;
  final ChangeCause cause;

  /// The command that produced this state, when [cause] is [ChangeCause.command].
  /// For a batch, its last command.
  final Command? command;
  const EditorChange(this.project, this.cause, [this.command]);
}

/// Holds a project, applies commands to it and keeps undo history.
///
/// Every change replaces [project] with a new object. Treat the project you read as
/// read-only: change it only through [dispatch], [batch], [undo], [redo] and [load].
class Editor {
  final IdFactory _ids;
  final int _limit;
  Project _project;
  List<Project> _past = [];
  final List<Project> _future = [];
  final _changes = StreamController<EditorChange>.broadcast(sync: true);

  /// Start from an existing CPF document ([project], validated by [parseProject])
  /// or from an empty one. [historyLimit] is the number of undo steps kept, 200 by default.
  Editor({
    Object? project,
    IdFactory ids = randomId,
    int historyLimit = 200,
    int? width,
    int? height,
    Rational? fps,
    int? sampleRate,
  }) : _ids = ids,
       _limit = historyLimit,
       _project =
           project != null
               ? parseProject(project)
               : createProject(width: width, height: height, fps: fps, sampleRate: sampleRate, ids: ids);

  /// The current project.
  Project get project => _project;
  Us get durationUs => projectDurationUs(_project);
  bool get canUndo => _past.isNotEmpty;
  bool get canRedo => _future.isNotEmpty;

  /// Every change, delivered synchronously as it happens.
  Stream<EditorChange> get changes => _changes.stream;

  void _commit(Project next, Command command) {
    _past.add(_project);
    if (_past.length > _limit) _past = _past.sublist(_past.length - _limit);
    _future.clear();
    _project = next;
    _changes.add(EditorChange(_project, ChangeCause.command, command));
  }

  /// Apply one command as one undo step. If it throws, nothing changes.
  R dispatch<R extends CommandResult>(Command<R> command) {
    final draft = _project.copy();
    final result = applyCommand(draft, command, _ids);
    _commit(draft, command);
    return result;
  }

  /// Apply several commands as one undo step. All or nothing.
  void batch(List<Command> commands) {
    if (commands.isEmpty) return;
    final draft = _project.copy();
    for (final c in commands) {
      applyCommand(draft, c, _ids);
    }
    _commit(draft, commands.last);
  }

  bool undo() {
    if (_past.isEmpty) return false;
    _future.add(_project);
    _project = _past.removeLast();
    _changes.add(EditorChange(_project, ChangeCause.undo));
    return true;
  }

  bool redo() {
    if (_future.isEmpty) return false;
    _past.add(_project);
    _project = _future.removeLast();
    _changes.add(EditorChange(_project, ChangeCause.redo));
    return true;
  }

  /// Replace the project with another CPF document and clear history.
  /// If the document is invalid, this throws and keeps the current project.
  void load(Object? input) {
    _project = parseProject(input);
    _past = [];
    _future.clear();
    _changes.add(EditorChange(_project, ChangeCause.load));
  }

  /// The current project as a CPF JSON object (a copy).
  Map<String, Object?> toJson() => _project.toJson();

  /// Stop delivering [changes].
  Future<void> dispose() => _changes.close();
}
