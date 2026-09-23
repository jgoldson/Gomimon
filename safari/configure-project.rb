require 'xcodeproj'
root = File.expand_path(__dir__)
project = Xcodeproj::Project.open(File.join(root, 'GomiMon Safari/GomiMon Safari.xcodeproj'))
project.targets.each do |target|
  target.build_configurations.each do |config|
    config.build_settings['DEVELOPMENT_TEAM'] = '72UJTW8297'
    config.build_settings['CODE_SIGN_STYLE'] = 'Automatic'
    config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '17.0' if target.name.include?('(iOS)')
    config.build_settings['MACOSX_DEPLOYMENT_TARGET'] = '14.0' if target.name.include?('(macOS)')
  end
  next if target.name.include?('Extension')
  scheme = Xcodeproj::XCScheme.new
  scheme.add_build_target(target)
  scheme.set_launch_target(target)
  scheme.save_as(project.path, target.name, true)
end
project.save
