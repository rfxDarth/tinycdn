    //TODO: File not found error
    //TODO: Wrong decryption key error
    //TODO: wrong key error
    //TODO: asyncify metadata reads/writes

//config
const port=8000;
const { v4: uuidv4 } = require('uuid');
const algorithm = 'aes-256-ctr';

//corelibs
const fs = require('fs');
const zlib = require('zlib');
const http = require('http');
const url = require('url');

//third party libs
const express = require('express');
const busboy = require('connect-busboy');
const crypto = require('crypto');
const { resolve } = require('path');
const meter = require('stream-meter');

//init
const app = express()
app.set('view engine', 'ejs');
app.use(busboy({ immediate: true }));

//routes
app.get('/', function (req, res) {
    res.render('form', {});
  })


app.use('/upload', function (req, res) {
    const allowed_rest_methods=["POST","PUT"]; //no OPTIONS. Screw CORS!
    if(!allowed_rest_methods.includes(req.method))
        return res.send(`Invalid rest method. Only ${allowed_rest_methods.join(" and ")} are allowed on this URL`);

    let key;
    let uuid=uuidv4();
    req.busboy.on('field', function(formkey, formvalue, keyTruncated, valueTruncated) {
        if(formkey==="key")
            key=formvalue;
    });
    req.busboy.on('file', function(fieldname, file, filename, encoding, mimetype) {
        let metadata={filename,encoding,mimetype,algorithm};

        console.log(`Uploading: ${uuid}`);

        if(typeof key === 'undefined')
            return res.end("Error: key was not set. Check the form fields order.")
        let encrypt = crypto.createCipher(algorithm, key);
        let write_stream = fs.createWriteStream(`${__dirname}/uploads/${uuid}`);
        let zip = zlib.createGzip();
        let m = meter();

        
        file
          .pipe(m)
          .pipe(encrypt)
          .pipe(zip)
          .pipe(write_stream)

        write_stream.on('close', function () {    
            metadata.size=m.bytes;
            fs.writeFile(`${__dirname}/uploads/${uuid}.meta.json`, JSON.stringify(metadata),function(){});
            res.render("upload_finish",{uuid,key});
        });
    });
    req.busboy.on('finish', function() {
        console.log("finish");
    });
})
app.get(/\/uploads\/([a-f0-9\-]+)/,function(req,res){
    let queryObject = url.parse(req.url,true).query;
    let uuid=req.params[0];
    let key=queryObject.key;
    let metadata=JSON.parse(fs.readFileSync(`${__dirname}/uploads/${uuid}.meta.json`));
    
    let decrypt = crypto.createDecipher(algorithm, key)
    let unzip = zlib.createGunzip();
    rstream = fs.createReadStream(`${__dirname}/uploads/${uuid}`);

    res.writeHead(200, {
        'Content-Type': metadata.mimetype,
        'Content-Length': metadata.size
    });
    rstream
        .pipe(unzip)
        .pipe(decrypt)
        .pipe(res);
})

//flexing with promises
app.use(/\/delete\/([a-f0-9\-]+)/,async function(req,res){
    const allowed_rest_methods=["POST","DELETE"];
    if(!allowed_rest_methods.includes(req.method))
        return res.send(`Invalid rest method. Only ${allowed_rest_methods.join(" and ")} are allowed on this URL`);

    let uuid=req.params[0];
    let deleteFile=new Promise(function(resolve,reject){
        fs.unlink(`${__dirname}/uploads/${uuid}`, (err) => {
            if (err) 
                reject(`Error removing file: ${err}`);
            resolve()
        })
    });
    let deleteMetadata=new Promise(function(resolve,reject){
        fs.unlink(`${__dirname}/uploads/${uuid}.meta.json`, (err) => {
            if (err) 
                reject(`Error removing file: ${err}`);
            resolve()
        })
    });
    try {
        await Promise.all([deleteFile,deleteMetadata])
        res.send("Files succesfully deleted");
    } catch (e){
        res.send(e);
    }
})

//start app
app.listen(port, () => {
    console.log(`App listening at http://localhost:${port}`)
})