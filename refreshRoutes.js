// refreshRoutes makes a file of all the static route data -
// stops, color, pid/pid names, and path lat/longs
// @author Rodney Reid
// 
'use strict'

const fetch = require('node-fetch')
const fs = require('fs')
const { PerformanceObserver, performance } = require('perf_hooks')

// Set the following in your enviroment; ( export MCTSAPIKEY="----some jumble of characters---"  in shell)
const MCTSAPIKEY = process.env.MCTSAPIKEY // MILWAUKEE - get your own key: http://realtime.ridemcts.com/bustime/newDeveloper.jsp
const CTAAPIKEY = process.env.CTAAPIKEY // CHICAGO - get your own key: http://www.ctabustracker.com/bustime/newDeveloper.jsp

const BUSURL = 'http://realtime.ridemcts.com/bustime/api/v3/'
const CTABUSURL = 'http://www.ctabustracker.com/bustime/api/v2/'

const BUSPATTERN = `${BUSURL}getpatterns?key=${MCTSAPIKEY}&tmres=s&format=json&rt=`
const BUSROUTES = `${BUSURL}getroutes?key=${MCTSAPIKEY}&format=json`

let routes = {} // complete collection of all the fetches of routes, routeinfo, etc

// General information on all the bus routes available -- name, color, route moniker
// @return array - each of the MCTS bus routes ex: { rt: "BLU", rtnm: "Fond du Lac", rtclr: "#000000", rtdd: "BLU" },
async function busroutes() {
  let response
  try {
    response = await fetch(BUSROUTES)
    response = await response.json() 

    const routex = response['bustime-response'].routes
    routex.forEach(route => 
      routes[route.rt] = {
        nm: route.rtnm,
        dd: route.rtdd,
        clr: route.rtclr
      })
    return routes
  } catch (e) {
    console.error(`Can't fetch routes, aborting.`)
    exit()
  }
  
}

// 
async function getPatterns(route) {
  console.log(`${route} patterns`)
  let response
  try {
    response = await fetch(`${BUSPATTERN}${route}`)
    response = await response.json()
    if(!optimizeJSON) {
      routes[route].ptr = response['bustime-response'].ptr
    } else {
      routes[route].ptr = response['bustime-response'].ptr
      for (let ptr in routes[route].ptr) {
        for (let pt in routes[route].ptr[ptr]) {
          // @todo:  shrink up ludicrously fake precise lat/longs here
        }
      }
      routes[route].ptr = response['bustime-response'].ptr
    }
    return routes[route]
  } catch (e) {
    console.error(`Error fetching ${BUSPATTERN}${route}  aborting.`)
    exit() // TODO - maybe NOT abort so abruptly?
  }
}


async function getAllPatterns() {
  await busroutes()

  const starttime = performance.now()
  const routeKeys = Object.keys(routes)
  await Promise.all(routeKeys.map(async route => {  // 5100ms!
    await getPatterns(route) 
  }))

  //for (let route in routes) {   // <-- my old code... WEAK - 7x slower!  lol
  //  await getPatterns(route)    // 35000ms
  //}

  console.log(`Fetches done in ${Math.floor(performance.now()-starttime)}ms.    Saving routes.json`)
  fs.writeFile("routes.json", JSON.stringify(routes), 'utf8', err => {
    if (err) {
      console.log("An error occured while writing the routes out")
      console.dir(err)
    } else {
      console.log("routes have been saved.")
    }
  })  
}

getAllPatterns()
