const net = require('net')
const server = net.createServer()

server.listen(3000, () => {
  console.log('server started!')
})

const errorMessage = Buffer.from([0x10, 0x03, 0x62, 0x61, 0x64])

const cameras = {}, dispatchers = {}, record = {}, tickets = {}, heartbeat = new Set(), days = {}, dispatcherSet = new Set()

function sendTicket(plate, road, m1, m2, t1, t2, speed) {

  let code = Buffer.from([0x21])
  let plateMsg = Buffer.from(plate)
  let plateLen = Buffer.from([plate.length])

  let roadBuf = Buffer.allocUnsafe(2)
  roadBuf.writeUInt16BE(road, 0)

  let m1Buf = Buffer.allocUnsafe(2)
  let t1Buf = Buffer.allocUnsafe(4)
  let m2Buf = Buffer.allocUnsafe(2)
  let t2Buf = Buffer.allocUnsafe(4)

  if (t2 > t1) {
    m1Buf.writeUInt16BE(m1, 0)
    t1Buf.writeUInt32BE(t1, 0)

    m2Buf.writeUInt16BE(m2, 0)
    t2Buf.writeUInt32BE(t2, 0)
  } else {
    m1Buf.writeUInt16BE(m2, 0)
    t1Buf.writeUInt32BE(t2, 0)

    m2Buf.writeUInt16BE(m1, 0)
    t2Buf.writeUInt32BE(t1, 0)
  }

  let speedBuf = Buffer.allocUnsafe(2)
  speedBuf.writeUInt16BE(speed * 100, 0)

  const ticket = Buffer.concat([code, plateLen, plateMsg, roadBuf, m1Buf, t1Buf, m2Buf, t2Buf, speedBuf])

  const dayMin = Math.floor(Math.min(t1, t2) / 86400), dayMax = Math.floor(Math.max(t1, t2) / 86400)
  console.log(`dayRange ${dayMin} - ${dayMax}`)
  const day = Math.floor(t2 / 86400)

  let n = 1
  for (let day = dayMin; day <= dayMax; day++) {
    if (!days[day]) {
      days[day] = new Set()
    }
    if (days[day].has(plate)) {
      n = 0
    } else {
      // count ticket for all days
      days[day].add(plate)
    }
  }

  if (n) {
    console.log(`sending day ${day} for ${plate}  timestampts: ${t1} ${t2}, dayMin: ${dayMin}, dayMax: ${dayMax}`)
    dispatchTicket()
    days[day].add(plate)
  }

  function dispatchTicket() {
    if (dispatchers[road]) {
      const socket = dispatchers[road]
      console.log(`dispatching the ticket for ${plate}`)
      socket.write(ticket)
    } else {
      console.log(`ticket stored!: ${Date.now()}`)
      if (!tickets[road]) {
        tickets[road] = {}
      }
      console.log(`storing the ticket for ${plate}`)
      tickets[road][plate] = ticket
    }
  }
}

server.on('connection', sock => {
  const { remotePort, remoteAddress } = sock

  const clientKey = `${remoteAddress}:${remotePort}`

  let buf = '', newMessage = true, c = ''

  sock.on('data', msg => {

    if (newMessage) {
      buf = msg
      c = buf[0]
    } else {
      buf = Buffer.concat([buf, msg])
      console.log(clientKey, msg)

      if (!c) {
        c = buf[0]
      }
    }

    console.log(clientKey, c)

    while (buf.length > 0 && c) {
      switch (c) {
        case 0x80: {// IAmCamera

          if (cameras[clientKey] || dispatcherSet.has(clientKey)) {
            sock.write(errorMessage)
            sock.destroy()
            return
          }
          console.log(`buf length ${buf.length}`)
          if (buf.length < 7) {
            c = undefined
            newMessage = false
            break;
          }

          const road = buf.slice(1, 3).readUInt16BE(0)
          const mile = buf.slice(3, 5).readUInt16BE(0)
          const limit = buf.slice(5, 7).readUInt16BE(0)

          cameras[clientKey] = {
            road, mile, limit
          }

          buf = buf.slice(7)
          c = buf[0]
          break
        }
        case 0x20: { //Plate

          if (!cameras[clientKey]) {
            sock.write(errorMessage)
            sock.destroy()
            return
          }

          if (buf.length < 2) {
            newMessage = false
            c = undefined
            break;
          }

          const plateLength = buf[1]
          const tsStart = 2 + plateLength
          const tsEnd = 2 + plateLength + 4

          if (buf.length < tsEnd) {
            newMessage = false
            c = undefined
            break;
          }

          const plate = buf.slice(2, tsStart).toString()

          const timestamp = buf.slice(tsStart, tsEnd).readUInt32BE(0)

          const { road, mile, limit } = cameras[clientKey]
          const k = `${road}:${plate}`

          const day = Math.floor(timestamp / 86400)

          console.log(`Plate: ${plate}, TS: ${timestamp}, day: ${day}, road: ${road}, mile: ${mile}, limit: ${limit}`)

          if (record[k]) {
            const carEntries = record[k]

            for (let entry of carEntries) {

              if (days[day] && days[day].has(plate)) {
                break
              }

              const day2 =  Math.floor(entry['timestamp'] / 86400)

              if (days[day2] && days[day2].has(plate)) {
                continue
              }

              const speed = Math.abs(entry['mile'] - mile) / Math.abs(entry['timestamp'] - timestamp) * 3600

              if (speed >= limit + 0.5) {
                //console.log(`new tckt for ${plate} with ${day} and ${day2}`, road, mile, entry['mile'], timestamp, entry['timestamp'], speed)
                console.log(`new tckt for ${plate} with ${day} and ${day2}`)
                sendTicket(plate, road, mile, entry['mile'], timestamp, entry['timestamp'], speed)
              }
            }
            
            record[k].push({ mile, timestamp })
          } else {
            record[k] = [{ mile, timestamp }]
          }

          buf = buf.slice(tsEnd)
          c = buf[0]
          break
        }

        case 0x81: {

          if (cameras[clientKey] || dispatcherSet.has(clientKey)) {
            console.log(`sending error to dispatcher ${cameras[clientKey]} ${dispatcherSet.has(clientKey)}`)
            sock.write(errorMessage)
            sock.destroy()
            return
          }

          if (buf.length < 2) {
            newMessage = false
            c = undefined
            break;
          }

          const numRoads = buf[1]
          let r = 0

          if (buf.length < 2 + numRoads * 2) {
            console.log('break dispatch', buf)
            newMessage = false
            c = undefined
            break;
          }

          console.log('got dispatcher', numRoads)

          for (let i = 2; r < numRoads; i += 2) {
            const road = buf.slice(i, i + 2).readUInt16BE(0)
            console.log(`got dispatcher for ${road}`)
            if (!dispatchers[road]) {
              dispatchers[road] = sock
              //const plates = Object.keys(tickets[road])
              for (let plate in tickets[road]) {
                console.log(`ticket sent!: ${Date.now()}`)
                const ticket = tickets[road][plate]
                console.log(`sending ticket for ${plate}: ${Date.now()}`)
                sock.write(ticket)
              }

              delete tickets[road]
            }
            console.log('road', road)
            r += 1
          }

          buf = buf.slice(2 + numRoads * 2)

          if (c === 0x81) {
            dispatcherSet.add(clientKey)
          }

          c = buf[0]
          console.log('breaking!', c, buf.length)
          break
        }

        case 0x40: {

          if (heartbeat.has(clientKey)) {
            sock.write(errorMessage)
            sock.destroy()
            return
          }

          heartbeat.add(clientKey)

          if (buf.length < 5) {
            newMessage = false
            c = undefined
            break;
          }

          const interval = buf.slice(1, 5).readUInt32BE(0) / 10

          interval > 0 && setInterval(() => {
            sock.write(Buffer.from([0x41]))
          }, interval * 1000)

          buf = buf.slice(5)
          c = buf[0]
          break
        }
        
          /*
        case 0x10, 0x21, 0x41: {
          sock.write(errorMessage)
          sock.destroy()
          return
        }
          */

        default: {
          sock.write(errorMessage)
          sock.destroy()
          return
        }
      }

      /*
      if(!newMessage) {
        break
      }
      */

    }
  })
})
