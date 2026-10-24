import Foundation
import CryptoKit
import Security

struct AppleAuthChallenge {
    let nonce: String
    let state: String
    var hashedNonce: String { Self.hash(nonce) }
    static func hash(_ value: String) -> String {
        SHA256.hash(data:Data(value.utf8)).map { String(format:"%02x",$0) }.joined()
    }
    static func make() throws -> AppleAuthChallenge {
        func random() throws -> String {
            var bytes=[UInt8](repeating:0,count:32)
            guard SecRandomCopyBytes(kSecRandomDefault,bytes.count,&bytes)==errSecSuccess else {
                throw NSError(domain:"Letm3goAppleAuthentication",code:1)
            }
            return bytes.map { String(format:"%02x",$0) }.joined()
        }
        return try AppleAuthChallenge(nonce:random(),state:random())
    }
}
