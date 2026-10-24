import AuthenticationServices
import Capacitor
import CryptoKit
import Security
import UIKit

extension SecureSessionPlugin: ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    @objc func signInWithApple(_ call: CAPPluginCall) { DispatchQueue.main.async {
        guard self.bridge?.viewController?.view.window != nil else { call.reject("Open the app before signing in with Apple."); return }
        guard self.appleCall == nil else { call.reject("Apple sign-in is already open."); return }
        let challenge: AppleAuthChallenge
        do { challenge=try AppleAuthChallenge.make() } catch { call.reject("Unable to prepare secure Apple sign-in."); return }
        self.appleNonce=challenge.nonce; self.appleState=challenge.state; self.appleCall=call
        let request=ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes=[.fullName,.email]; request.state=challenge.state
        request.nonce=challenge.hashedNonce
        let controller=ASAuthorizationController(authorizationRequests:[request]); controller.delegate=self; controller.presentationContextProvider=self
        self.appleController=controller; controller.performRequests()
    } }
    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor { bridge?.viewController?.view.window ?? ASPresentationAnchor(frame:.zero) }
    public func authorizationController(controller: ASAuthorizationController,didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let call=appleCall else { return };defer { appleCall=nil; appleNonce=nil; appleState=nil; appleController=nil }
        guard let credential=authorization.credential as? ASAuthorizationAppleIDCredential, credential.state==appleState,
              let data=credential.identityToken, let token=String(data:data,encoding:.utf8), let nonce=appleNonce else { call.reject("Apple credentials could not be verified."); return }
        var value: [String:Any] = ["idToken":token,"nonce":nonce]
        if let code=credential.authorizationCode.flatMap({String(data:$0,encoding:.utf8)}) { value["authorizationCode"]=code }
        if let name=credential.fullName { value["name"]=PersonNameComponentsFormatter().string(from:name) }
        call.resolve(value)
    }
    public func authorizationController(controller: ASAuthorizationController,didCompleteWithError error: Error) {
        let cancelled = (error as? ASAuthorizationError)?.code == .canceled
        appleCall?.reject(cancelled ? "Apple sign-in was cancelled." : "Apple sign-in could not be completed. Check the Letm3go Apple configuration.", cancelled ? "APPLE_SIGN_IN_CANCELLED" : "APPLE_SIGN_IN_FAILED")
        appleCall=nil; appleNonce=nil; appleState=nil; appleController=nil
    }
}
