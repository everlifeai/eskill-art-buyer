'use strict'
const cote = require('cote')({statusLogsEnabled:false})
const u = require('@elife/utils')
const os = require('os')
const fs = require('fs')
const http = require('http')
const path = require('path')
const shortid = require('shortid')
const https = require('https')

/**
 *  understand/
 * This is the main entry point where we start.
 * 
 *   outcome/
 * Start our microservice and register with the communication manager
 * and SSB
 */
function main() {
  startMicroService()
  registerWithCommMgr()
  registerWithDirectMsg()
}

let msKey = 'eskill-art-buyer-svc'

const directMsgClient = new cote.Requester({
  name: 'art buyer ->  direct msg',
  key: 'everlife-dir-msg-demo-svc',
})

const stellarClient = new cote.Requester({
  name: 'art buyer -> Stellar',
  key: 'everlife-stellar-svc',
})



function registerWithDirectMsg() {
  directMsgClient.send({
    type: 'register-direct-msg-handler',
    mskey: msKey,
    mstype: 'direct-msg'
  })
}

const ssbClient = new cote.Requester({
  name: 'direct-message -> SSB',
  key: 'everlife-ssb-svc',
})

const commMgrClient = new cote.Requester({
  name: 'art buyer -> CommMgr',
  key: 'everlife-communication-svc',
})



/*      outcome/
 * Register ourselves as a message handler with the communication
 * manager.
 */
function registerWithCommMgr() {
  commMgrClient.send({
      type: 'register-msg-handler',
      mskey: msKey,
      mstype: 'msg',
      mshelp: [ { cmd: '/buy_art', txt: 'send a requst to seller' } ],
  }, (err) => {
      if(err) u.showErr(err)
  })
}

function sendReply(msg, req) {
  req.type = 'reply'
  req.msg = String(msg)
  commMgrClient.send(req, (err) => {
      if(err) u.showErr(err)
  })
}

function startMicroService() {
    /**
     *   understand/
     * The microService (partitioned by key to prevent conflicting with other services)
     */

    const svc = new cote.Responder({
        name: 'Art buyer skill',
        key: msKey
    })

    svc.on('msg', (req, cb) => {
        console.log(JSON.stringify(req))
        if(!req.msg) return cb()
        let msg = req.msg.trim()
        if(msg.startsWith('/buy_art')){
          cb(null, true)
          let data = msg.split(' ')
          if(data.length < 2){
            sendReply(`Please enter valid information for buy art`, req)
            
          } else {
            let userID = data[1]
            if(data.length == 2) {
              if(userID.startsWith('@') && userID.endsWith('.ed25519')){
                userID = userID.trim()
                directMessage(req, '/buy-art-req', userID, ' ', (err) => {
                  if(err) sendReply('Something went wrong, try after sometime', req)
                  else {
                    sendReply(`Sent a request to Art seller ${userID}`, req)
                  }
                })
              } else {
                sendReply('Please enter valid avatar id', req)
              }
              
            } else{
              let style = data[2]
              if(userID.startsWith('@') && userID.endsWith('.ed25519') && style) {
                userID = userID.trim()
                style = style.trim()
                directMessage(req, '/buyer-art-style', userID, style, (err) => {
                  if(err) sendReply('Something went wrong, try after sometime', req)
                  else {
                    sendReply(`Sent art style (${style}) to seller ${userID}`, req)
                  }
                })
              } else {
                sendReply('Please enter valid avatar id and style')
              }

            }
          }
        }else if(msg.startsWith('/art_image')){
          cb(null, true)
          let data = msg.split(' ')
          if(data.length < 2 && !req.file) {
            sendReply('user id or image file is missing ', req)
          } else {
            let userId = data[1]
            if(userId.startsWith('@') && userId.endsWith('.ed25519')) {
              writeFileInTmpDir(req.file, (err, filePath) => {
                console.log(filePath)
                if(err) console.log(err)
                else{
                  ssbClient.send({type:'box-blob-save-file',filePath: filePath},(err, boxValue)=> {
                    if(err) console.log(err)
                    else {
                      console.log(`blob value ${boxValue}`)
                      directMessage(req, '/buyer-art-image', userId, boxValue, (err)=>{
                        if(err) sendReply('Something went wrong, please try after sometimes', req)
                        else sendReply('Sent your image to art seller ' + userId, req)
                      })
                    }
                  })
                } 
              })
            } else {
              sendReply('Invalid user id', req)
            }
          }
          
        } else {
          cb()
        } 
    })

    svc.on('direct-msg', (req, cb) => {
      processMsg(req.msg, cb)
    })

}

function writeFileInTmpDir(fileUrl, cb) {
  
    let name = shortid.generate()
    
    let inFile = path.join(os.tmpdir(), name)
    
    const file = fs.createWriteStream(inFile);
    if(fileUrl.startsWith('https')) {
      const request = https.get(fileUrl, function(response) {
        response.pipe(file);
        file.on('finish', ()=>{
          file.close()
          cb(null, inFile)
        })
      });
    } else {
      const request = http.get(fileUrl, function(response) {
        response.pipe(file);
        file.on('finish', () => {
          file.close()
          cb(null, inFile)
        })
      }); 
    }
  
}

function sendMsgOnLastChannel(req) {
  req.type = 'reply-on-last-channel'
  commMgrClient.send(req, (err) => {
      if(err) u.showErr(err)
  })
}

/**
 *  outcome/
 * If this is a message for art buyer sent by art seller,
 * relay it to my owner over the last used channel
 * 
 * @param {*} msg 
 */
function processMsg(msg, cb) {
  let text = msg.value.content.text
  console.log(text)
  if(text.startsWith('/seller-art-style-req')) {
    cb(null, true)
      let style = text.replace('/seller-art-style-req','').trim()
      sendMsgOnLastChannel({
        msg: `Got message from ${msg.value.author} Art style request. Available styles are\n
              ${style.replace(',','\n')} \n
              /buy_art ${msg.value.author} <style>`
      })
  } else if(text.startsWith('/seller-claimable-balance-id-req')) {
                              
    cb(null, true)
      sendMsgOnLastChannel({
        msg: `Got Request from art seller (${msg.value.author}) for claimable balance id`
      })
      createClaimableBalance((err, id) => {
        console.log('claimable balance error ' +err)
        console.log('claimable balance id ' + id)
        if(err) console.log(err)
        else {
          directMessage(null, '/buyer-claimable-balance-id', msg.value.author, id,(err)=>{
            if(err) console.log(err)
          })
        }
      })
  } else if(text.startsWith('/seller-art-img-req')){
    cb(null, true)
    sendMsgOnLastChannel({
      msg:'Please attach a file with command /art_image'
    })
  } else {
    cb()
  }

}




/*      outcome/
 * Post a 'direct message' to someone on my feed and let the network
 * replicate it to the recipient
 */
function directMessage(req, type, userID, msg, cb) {
  ssbClient.send({
      type: 'new-msg',
      msg: {
          type: 'direct-msg',
          to: userID,
          text: type + " " + msg
      },
  }, cb)
}



function createClaimableBalance(cb) {
  stellarClient.send({type:'claimable-balance-id'},(err, claimBalanceId) => {
      cb(null, claimBalanceId)
  })
}

main()