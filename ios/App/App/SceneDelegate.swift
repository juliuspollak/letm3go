import UIKit
import Capacitor
import UserNotifications

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.backgroundColor = UIColor(red:246/255.0,green:247/255.0,blue:251/255.0,alpha:1)
        window?.rootViewController = JourneyViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    // The icon badge is the unread count at the time of the last push; opening the
    // app clears it. The profile bubble inside the app shows what is still unread.
    func sceneDidBecomeActive(_ scene: UIScene) {
        if #available(iOS 16.0, *) { UNUserNotificationCenter.current().setBadgeCount(0) }
        else { UIApplication.shared.applicationIconBadgeNumber = 0 }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
