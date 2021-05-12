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

let TSS_PUBLIC_KEY
let TSS_URL
let TSS_HASH
let TSS_SIGNER
let TSS_SALE_PRICE
let TSS_TX_FN_FEE

let ARTSIE_BOT
let ARTSIE_STYLES
let CONV_CTX = {}
function loadConfigInfo() {
  ARTSIE_BOT = v('ARTSIE_BOT')
  if(!ARTSIE_BOT) return
  ARTSIE_STYLES = v('ARTSIE_STYLES')
  if(!ARTSIE_STYLES) return
  ARTSIE_STYLES = ARTSIE_STYLES.split(',').map(s => s.trim())

  TSS_PUBLIC_KEY = v('TSS_PUBLIC_KEY')
  if(!TSS_PUBLIC_KEY) return
  TSS_URL = v('TSS_URL')
  if(!TSS_URL) return
  TSS_HASH = v('TSS_HASH')
  if(!TSS_HASH) return
  TSS_SIGNER = v('TSS_SIGNER')
  if(!TSS_SIGNER) return
  TSS_SALE_PRICE = v('TSS_SALE_PRICE')
  if(!TSS_SALE_PRICE) return
  TSS_TX_FN_FEE = v('TSS_TX_FN_FEE')
  if(!TSS_TX_FN_FEE) return

  return true

  function v(n) {
    if(process.env[n]) return process.env[n].trim()
  }
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

function sendReply(msg, req, cb) {
  req.type = 'reply'
  req.msg = String(msg)
  commMgrClient.send(req, (err) => {
    if(err) u.showErr(err)
    if(cb) cb()
  })
}

function sendReplies(replies, req, cb) {
    send_replies_1(0)

    function send_replies_1(ndx) {
        if(ndx >= replies.length) {
          if(cb) return cb()
          return
        }
        sendReply(replies[ndx], req, () => {
          setTimeout(() => send_replies_1(ndx+1), 1200)
        })
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
    const ctx = CONV_CTX[req.ctx]
    let replies = get_replies_1(req)
    if(replies && typeof replies === 'function') replies = replies(req.msg, req.file)
    if(!replies) {
      if(ctx) ctx.num = 0
      return cb()
    }

    if(typeof replies === 'function') return replies(req, cb)

    if(!Array.isArray(replies)) replies = [replies]

    ctx.num++
    cb(null, true)

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
      CONV_CTX[req.ctx] = {
        num: 1,
        style: null,
      }
    }

    const ctx = CONV_CTX[req.ctx]
    if(!ctx || !ctx.num) return

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
            `He'll need an input image from you and you can choose one of these ${ARTSIE_STYLES.length} styles
${ARTSIE_STYLES.join('\n')}
`,
            `Type in the style of your choice (for example: ${ARTSIE_STYLES[0]})`
          ]
          return resp
        }
        if(msg === "no") {
          ctx.num = 0
          return "Ok sure. If you do want it at any time, just let me know"
        }
      },
      msg => {
        if(ARTSIE_STYLES.indexOf(msg) === -1) {
          ctx.num = 0
          return [
            `I didn't understand the style '${msg}'...`,
            `Whenever you want, you can try to /buy_art again`
          ]
        }
        ctx.style = msg
        return [
          `Great! Let's draw in ${ctx.style} style!`,
          `Send me the image you'd like to work on
(Please make sure it's less than 5MB)`
        ]
      },
      (msg, file) => {
        if(!file) {
          ctx.num = 0
          return `Did not get file to work on...stopping`
        }
        return letsMakeArt
      },
    ]
    const curr = replies[ctx.num-1]
    if(typeof curr === 'function') return curr
    if(curr.m === req.msg) return curr.r
  }

  function letsMakeArt(req, cb) {
    const ctx = CONV_CTX[req.ctx]
    cb(null, true)
    writeFileInTmpDir(req.file, (err, p) => {
      if(err) {
        u.showErr(err)
        sendReply('Something went wrong! Please try again after some time', req)
        return
      }
      fs.stat(p, (err, stats) => {
        if(err) {
          u.showErr(err)
          sendReply('Something went wrong! Please try again after some time', req)
          return
        }
        if((stats.size / (1024*1024)) > 5) {
          sendReply('Uploaded file is too big for me!', req)
          return
        }
        sendReply(`Creating a claimable balance of ${TSS_SALE_PRICE}XLM to pay the artist bot...`)
        createClaimableBalanceID((err, balid) => {
          if(err) {
            u.showErr(err)
            sendReply('Something went wrong! Please try again after some time', req)
            return
          }
          sendReplies([
            `Created a claimable balance for ${TSS_SALE_PRICE}XLM with id: ${balid}`,
            `Sending your picture to the artist bot now`,
          ], req)
          ssbClient.send({type:'box-blob-save-file',filePath: p}, (err, blobid)=> {
            if(err) {
              u.showErr(err)
              sendReply('Something went wrong! Please try again after some time', req)
              return
            }
            sendReplies([
              `Perfect! I've parceled it as blob: ${blobid}`,
              `Let me send across along with the claimable balance to artist ${ARTSIE_BOT}`,
              `Once the artist bot creates your NFT Asset, we will use the smart contract ${TSS_HASH} on ${TSS_URL} to execute the asset transer`,
              `This might take a few minutes...hang on. I'll let you know as soon as I hear from him.`
            ], req)
            directMessage(req, '/buyer-art-req', ARTSIE_BOT, blobid, balid, ctx.style, err => {
              if(err) {
                u.showErr(err)
                sendReply('Oh no! Something went wrong! Please reclaim your balance and try again', req)
                return
              }
            })
          })
        })
      })
    })
  }

  svc.on('direct-msg', (req, cb) => {
    processMsg(req.msg, cb)
  })

}

function writeFileInTmpDir(fileUrl, cb) {
  const name = shortid.generate()
  const f = path.join(os.tmpdir(), name)

  const w = fs.createWriteStream(f);
  let m = http
  if(fileUrl.startsWith("https:")) m = https
  m.get(fileUrl, resp => {
    resp.pipe(w)
    w.on('finish', ()=>{
      w.close()
      cb(null, f)
    })
  })
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
 */
function processMsg(msg, cb) {
  let text = msg.value.content.text
  let ctx = msg.value.content.ctx
  if(!text.startsWith('/art-image')) return cb()

  cb(null, true)

  let msg
  if(text.startsWith('/art-image-err')) {
    msg = text.replace('/art-image-err', 'Artist Failed:').trim()
  } else {
    msg = text.replace('/art-image','').trim()
  }

  sendMsgOnLastChannel({msg, ctx})
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
