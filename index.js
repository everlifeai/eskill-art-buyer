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
 * If we have a configured art bot, we start our
 * microservice and register with the communication manager
 * and direct message
 */
function main() {
  if(!loadConfigInfo()) return
  startMicroService()
  registerWithCommMgr()
  registerWithDirectMsg()
  getWalletAccount()
}

let msKey = 'eskill-art-buyer-svc'

let ARTSIE_BOT
let ARTSIE_STYLES
let CONV_CTX = {}
function loadConfigInfo() {
  ARTSIE_BOT = process.env.ARTSIE_BOT
  if(!ARTSIE_BOT) return
  ARTSIE_STYLES = process.env.ARTSIE_STYLES
  if(!ARTSIE_STYLES) return
  ARTSIE_STYLES = ARTSIE_STYLES.split(',').map(s => s.trim())
  return true
}

const directMsgClient = new cote.Requester({
  name: 'art buyer ->  direct msg',
  key: 'everlife-dir-msg-svc',
})



const stellarClient = new cote.Requester({
  name: 'art buyer -> Stellar',
  key: 'everlife-stellar-svc',
})

/*      outcome/
 * Load the wallet account from the stellar microservice
 */
let account
function getWalletAccount() {
    stellarClient.send({
        type: 'account-id',
    }, (err, acc_) => {
        if(err) u.showErr(err)
        else {
          account = acc_
        }
    })
}

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
      allowNonOwner: true,
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

function sendReplies(replies, req) {
    send_replies_1(0)

    function send_replies_1(ndx) {
        if(ndx >= replies.length) return
        sendReply(replies[ndx], req)
        setTimeout(() => send_replies_1(ndx+1), 2500)
    }
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
    let replies = get_replies_1(req)
    if(!replies) return cb()
    if(typeof replies == 'function') replies = replies(req.msg)
    if(!replies) return cb()

    CONV_CTX[req.ctx]++
    cb(null, true)
    if(!Array.isArray(replies)) replies = [replies]
    sendReplies(replies, req)
  })

  /*      problem/
   * We need to carry out a conversation with the user
   *
   *      way/
   * We keep track of the current context of the conversation
   * and respond accordingly
   */
  function get_replies_1(req) {
    if(!req || !req.msg || !req.ctx) return

    if(req.msg === "/buy_art") {
      CONV_CTX[req.ctx] = 1
    }

    if(!CONV_CTX[req.ctx]) return
    const replies = [
      {
        m: "/buy_art",
        r: [
          "I'm not good at drawing art, but a bot friend of mine is a good artist. Would you like me to get him to create an NFT Art Asset for you? (yes/no)"
        ]
      },
      msg => {
        if(msg === "yes") {
          let resp = [
            `He'll need an input image from you and you can choose one of these ${ARTSIE_STYLES.length} styles`,
            ...ARTSIE_STYLES
          ]
          return resp
        }
        if(msg === "no") {
          CONV_CTX[req.ctx] = 0
          return [ "Ok sure. If you do want it at any time, just let me know" ]
        }
      },
      msg => {
        if(ARTSIE_STYLES.indexOf(msg) === -1) {
          CONV_CTX[req.ctx] = 0
          return [
            `I didn't understand the style '${msg}'...`,
            `Whenever you want, you can try to /buy_art again`
          ]
        }
        let style = msg
        return [ `Great! Let's draw in ${msg} style!` ]
      }
    ]
    const curr = replies[CONV_CTX[req.ctx]-1]
    if(typeof curr === 'function') return curr
    if(curr.m === req.msg) return curr.r
  }

    function ignore() {
        console.log(req)
        let msg = req.msg ? req.msg.trim() :''
        if(msg.startsWith('/create_nft_art')){
          cb(null, true)
          sendReply(``, req)
        } else if(msg.startsWith('/yes_create_nft_art')) {
          cb(null, true)
          if(style){
            sendReply('Great, send me the image (less than 5MB)', req)
          } else {
            sendReply(``, req)
          }
        } else if(styles.indexOf(msg)>=0) {
          cb(null, true)
          style = msg
          sendReply(`Great this is going to cost 420XLM. I currently only have 100XLM. 
          Please pay to my account GASGGAGAGSGASGDAG and then type /yes_create_nft_art`,req)
        } else if(req.file && style){
          cb(null, true)
          writeFileInTmpDir(req.file, (err, filePath)=>{
            console.log(filePath)
            if(err) sendReply('Something went wrong!, Please try after sometime', req)
            else {
              const stats = fs.statSync(filePath)
              if((stats.size / (1024*1024))>5){
                sendReply('Please upload a image less than 5MB', req)
              } else {
                createClaimableBalanceID((err, id) => {
                  console.log('balance id'+id)
                  if(err) sendReply(err, req) 
                  else {
                    if(id){
                      ssbClient.send({type:'box-blob-save-file',filePath: filePath},(err, boxValue)=> {
                        if(err) u.showErr(err)
                        else {
                          directMessage(req, '/buyer-art-req', ARTSIE_BOT, boxValue, id, style, (err) => {
                            if(err) u.showErr(err)
                          })
                        }
                      })
                      sendReply(`Perfect, I just created a claimable balance for 420XLM id: ${id} and have sent it to @artsie_bot. 
                      This might take a few minutes.. hang on. Once @arstie_bot creates the NFT Asset, 
                      he's going to use a smart contract (#aaa4d948605fa72d00b3902483ed6670698c5c1c8f05a190237da609a87290a2) running on a Turing Signing Server (https://tss-wrangler.everlife.workers.dev/) to execute the asset transfer. 
                      I'll let you know as soon as I hear from him.`, req)
                    } else {
                      sendReply('Something went wrong with your wallet ', req)
                    }
                    
                    
                  }
                })
              }
            }
          })
         
        } else {
          cb()
        } 
    }

    svc.on('direct-msg', (req, cb) => {
      processMsg(req.msg, cb)
    })

}

function writeFileInTmpDir(fileUrl, cb) {
  
    let name = shortid.generate()
    
    let inFile = path.join(os.tmpdir(), name)
    
    const file = fs.createWriteStream(inFile);
    if(fileUrl.startsWith('https')) {
      https.get(fileUrl, function(response) {
        response.pipe(file);
        file.on('finish', ()=>{
          file.close()
          cb(null, inFile)
        })
      });
    } else {
      http.get(fileUrl, function(response) {
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
  let ctx = msg.value.content.ctx
  if(text.startsWith('/art-image')){
    cb(null, true)
    let artUrl = text.replace('/art-image','').trim()
    if(ctx) {
      sendMsgOnLastChannel({msg: artUrl, ctx: ctx})
    } else sendMsgOnLastChannel({msg: artUrl})
    
  } else {
    cb()
  }

}




/*      outcome/
 * Post a 'direct message' to someone on my feed and let the network
 * replicate it to the recipient
 */
function directMessage(req, command, userID, msg, claim, style, cb) {

  ssbClient.send({
      type: 'new-msg',
      msg: {
          type: 'direct-msg',
          to: userID,
          text: command + " " + msg,
          claim: claim,
          wallet: account,
          style: style,
          ctx: req.ctx
      },
  }, cb)
}



function createClaimableBalanceID(cb) {
  stellarClient.send({type:'claimable-balance-id'}, cb)
}

main()
