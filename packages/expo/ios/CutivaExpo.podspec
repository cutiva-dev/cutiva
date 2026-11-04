require 'json'
require 'fileutils'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

# The iOS side of @cutiva/expo (ADR 0007). It compiles in the Cutiva iOS engine
# (packages/engine-ios/Sources/CutivaEngine) from `Engine/`: a copy in the npm package
# (scripts/copy-engine.mjs), and in the monorepo a folder of symlinks to each source file, made
# here on every `pod install` (CocoaPods doesn't look inside a symlinked folder).
engine = File.join(__dir__, 'Engine')
monorepo = File.expand_path('../../engine-ios/Sources/CutivaEngine', __dir__)
if File.directory?(monorepo)
  FileUtils.rm_rf(engine)
  Dir.glob('**/*.swift', base: monorepo).sort.each do |rel|
    FileUtils.mkdir_p(File.dirname(File.join(engine, rel)))
    File.symlink(File.join(monorepo, rel), File.join(engine, rel))
  end
end
Pod::Spec.new do |s|
  s.name           = 'CutivaExpo'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = package['author']
  s.homepage       = package['homepage']
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/cutiva-dev/cutiva.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # Apache-2.0. The newest release on CocoaPods; the web and Android use 1.1.1 with the same model file.
  s.dependency 'MediaPipeTasksVision', '1.0.0'

  s.source_files = '*.swift', 'Engine/**/*.swift'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }
end
