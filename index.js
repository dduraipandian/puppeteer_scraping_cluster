const express = require('express');
const compression = require('compression');
const { Cluster } = require('puppeteer-cluster');

const port = process.env.PORT || 3000;
const appUser = process.env.USERNAME;
const appPassword = process.env.PASSWORD;
const windowSize = process.env.WINDOWSIZE || "1280,720";
const maxConcurrency = process.env.MAXCONCURRENCY || 5;


/*
Puppeteer (chromium) does not support proxy with basic authentication.
proxy-chain library helps to overcome this issue.

more info: https://github.com/apify/proxy-chain

* @return {url} local proxy chain url for the original proxy url.
*/
async function getProxyChain(){
    const proxyUrl = process.env.PROXY_URL;
    if(proxyUrl){
        const proxyChain = require('proxy-chain');
        const proxyChainUrl = await proxyChain.anonymizeProxy(proxyUrl);
        return proxyChainUrl;
    }
    return null;
};

/*
Authenticates api request with basic authentication USERNAME and PASSWORD environment
variables has to be set, as this package is expected to be published as microservice.

* @param {request} http request object
* @return {boolen} authentication is successful or not.
*/
function authRequest(req){
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader.indexOf('Basic ') === -1) {
        return res.status(401).json({ message: 'Missing Authorization Header' });
    }

    const base64Credentials =  authHeader.split(' ')[1];
    const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
    const [username, password] = credentials.split(':');
    const authenticated = username === appUser && password === appPassword;
    if (!authenticated) {
        return false;
    }
    return true;
};

/*
If the authentication is not successfull, sends 401 response to the client.

* @param {request} http request object
* @param {response} http response object
*/
function checkAuthentication(req, res, next){
    const isAuthenticated = authRequest(req);
    if (!isAuthenticated) {
        return res.status(401).json({ message: 'Invalid Authentication Credentials' });
    }
    next();
};

/*
Puppeteer cluster task to extract html content from the url.

* @param {page} page object by puppeteer cluster
* @param {data} url string
* @return {object} html content, headers, status code
*/
async function extractHtml({ page, data: url }){
    await page.setDefaultNavigationTimeout(0);
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 0 });
    return await page.content();
};


/*
Creates cluster options based on the environment variable set such as proxy, window size, concurrency.

* @return {object} puppeteer cluster options
*/
function getPuppeteerOptions(){
    const proxyChainUrl = getProxyChain();
    let puppeteerArgs = [
        "--no-sandbox",
        `--window-size=${windowSize}`
    ]

    if(proxyChainUrl){
        puppeteerArgs.push(`--proxy-server=${proxyChainUrl}`)
    }
    const options = {
        timeout: 1000 * 60 * 3,
        concurrency: Cluster.CONCURRENCY_CONTEXT,
        maxConcurrency: Number(maxConcurrency),
        puppeteerOptions: {
            headless: true,
            args: puppeteerArgs,
            defaultViewport: null
        }
    }
    return options
};


/*
scrape request is processed and sends reponse html content to client.

* @param {request} http request object
* @param {response} http response object
* @param {object} puppeteer cluster
*/
async function scrape(req, res, puppeteerCluster){
    console.log('request ', req.url);
    let url = decodeURI(req.query.url)
    console.time(url);
    try{
        let response = await puppeteerCluster.execute(url, extractHtml)
        console.timeEnd(url);
        res.send(response)
    } catch(err) {
        console.error(err)
        console.timeEnd(url);
        res.status(500).send('Scraping error');
    }
}

/*
Creates puppeteer cluster, starts the server and servers client request
*/
async function server(){
    const puppeteerClusterOptions = getPuppeteerOptions();
    const puppeteerCluster = await Cluster.launch(puppeteerClusterOptions);
    const app = express()
    const scrapeRoute = (req, res) => scrape(req, res, puppeteerCluster);
    app.use(compression())
    app.get('/scrape', [checkAuthentication], scrapeRoute);
    app.listen(port, () => console.log(`Application is running on port ${port}`));
};

server();