require 'xcodeproj'
root = File.expand_path('..', __dir__)
project = Xcodeproj::Project.new(File.join(root, 'GomiMon.xcodeproj'))
target = project.new_target(:application, 'GomiMon', :ios, '17.0')
package = project.new(Xcodeproj::Project::Object::XCRemoteSwiftPackageReference)
package.repositoryURL = 'https://github.com/google/GoogleSignIn-iOS.git'
package.requirement = { 'kind' => 'exactVersion', 'version' => '9.2.0' }
project.root_object.package_references << package
%w[GoogleSignIn GoogleSignInSwift].each do |name|
 product = project.new(Xcodeproj::Project::Object::XCSwiftPackageProductDependency)
 product.package = package
 product.product_name = name
 target.package_product_dependencies << product
 build_file = project.new(Xcodeproj::Project::Object::PBXBuildFile)
 build_file.product_ref = product
 target.frameworks_build_phase.files << build_file
end
group = project.main_group.new_group('GomiMon', 'GomiMon')
Dir.glob(File.join(root, 'GomiMon', '*.swift')).sort.each { |path| target.add_file_references([group.new_file(File.basename(path))]) }
resources = group.new_group('Resources', 'Resources')
Dir.glob(File.join(root, 'GomiMon', 'Resources', '*')).sort.each do |path|
 target.resources_build_phase.add_file_reference(resources.new_file(File.basename(path)))
end
{ 'reddit-detector.js' => '../reddit-detector.js', 'revision.js' => '../detector/revision.js', 'policy.js' => '../detector/policy.js', 'platforms.js' => '../platforms.js', 'x-detector.js' => '../x-detector.js', 'baby.gif' => '../sprites/animated/baby1_idle.gif', 'adult.gif' => '../sprites/animated/nimbus-gomi_idle.gif', 'egg.png' => '../assets/onboarding-egg.png', 'account.png' => '../assets/onboarding-account.png', 'pet.gif' => '../sprites/animated/bubble-gomi_idle.gif' }.each do |name, path|
 ref = project.main_group.new_file(path)
 target.resources_build_phase.add_file_reference(ref)
end
target.build_configurations.each do |config|
 config.build_settings.merge!({
  'PRODUCT_BUNDLE_IDENTIFIER' => 'com.goldentechlabs.gomimon.prototype',
  'GENERATE_INFOPLIST_FILE' => 'YES', 'INFOPLIST_FILE' => 'GomiMon/Info.plist', 'INFOPLIST_KEY_CFBundleDisplayName' => 'GomiMon Lab',
  'INFOPLIST_KEY_UILaunchScreen_Generation' => 'YES',
  'INFOPLIST_KEY_UIApplicationSceneManifest_Generation' => 'YES',
  'SWIFT_VERSION' => '5.0', 'TARGETED_DEVICE_FAMILY' => '1,2',
  'CURRENT_PROJECT_VERSION' => '1', 'MARKETING_VERSION' => '0.1.0',
  'CODE_SIGN_STYLE' => 'Automatic', 'DEVELOPMENT_TEAM' => '72UJTW8297',
  'CODE_SIGN_ENTITLEMENTS' => 'GomiMon/GomiMon.entitlements'
 })
end
project.root_object.attributes['TargetAttributes'] = {
 target.uuid => { 'DevelopmentTeam' => '72UJTW8297', 'SystemCapabilities' => {
  'com.apple.SignInWithApple' => { 'enabled' => 1 }, 'com.apple.Keychain' => { 'enabled' => 1 }
 } }
}
project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(target)
scheme.set_launch_target(target)
scheme.save_as(project.path, 'GomiMon', true)
