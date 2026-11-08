// Asks the push sender to deliver what the database just queued. Best effort: the
// outbox keeps anything undelivered for the next wake, so a failure here is silent.
export async function wakePush(client){
 try{await client?.functions?.invoke('send-push-notifications',{body:{}});}catch{/* retried on the next wake */}
}
