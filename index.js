    //TODO: File not found error
    //TODO: Wrong decryption key error
    //TODO: wrong key error
    //TODO: asyncify metadata reads/writes
    //TODO: There should be a way to make response machine-readable. 
    //      Maybe add additional endpoints or request extensions like those on reddit?
    //TODO: Tests, Postman, Swagger, Passport
    //TODO: JWT renewal
//config
const port=8000;
const encryption_algorithm = 'aes-256-ctr';
const jwt_secretkey = 'correct horse battery staple';

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
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const MongoAlikeDatabaseThatIsPortable = require('nedb');

//init
const app = express()
app.set('view engine', 'ejs');
app.use(busboy({ immediate: true }));
app.use(cookieParser());

const db = new MongoAlikeDatabaseThatIsPortable({ filename: 'sample_database.db', autoload: true }); 
// db.insert(
//     [
//         { username:"john_doe",
//         password: "12345678" },
//          { username:"vasya_pupkin",
//          password: "qwerty" }
//     ], 
//     function (err, newDocs) {
//         console.log("sample users loaded");
// });

app.use(function(req,res,next){  
    var cookies=req.cookies;
    if(cookies.jwt){
        var decoded = jwt.verify(cookies.jwt, jwt_secretkey);
        req.auth=decoded;
    }
    next();
})

//routes
app.get('/', function (req, res) {
    console.log(req.auth);
    res.render('index', {auth:req.auth});
})


app.use('/upload', function (req, res) {
    const allowed_rest_methods=["POST","PUT"]; //no OPTIONS. Screw CORS!
    if(!allowed_rest_methods.includes(req.method))
        return res.send(`Invalid rest method. Only ${allowed_rest_methods.join(" and ")} are allowed on this URL`);

        
    let postdata={}
    let uuid=uuidv4();
    req.busboy.on('field', function(formkey, formvalue, keyTruncated, valueTruncated) {
        postdata[formkey]=formvalue;
    });
    req.busboy.on('file', function(fieldname, file, filename, encoding, mimetype) {
        let metadata={filename,encoding,mimetype,algorithm: encryption_algorithm};
        let [key,is_private]=[postdata.key, postdata.is_private==="on"];
        console.log(`Uploading: ${uuid}`);

        if(typeof key === 'undefined')
            return res.end("Error: key was not set. Check the form fields order.")
        let encrypt = crypto.createCipher(encryption_algorithm, key);
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
            metadata.is_private=Boolean(is_private);
            if(is_private)
                metadata.owner=req.auth.username;
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
    if(metadata.is_private){
        if(!req.auth || req.auth.username!==metadata.owner)
            return res.end("Error: Unauthorized");
    }
    let decrypt = crypto.createDecipher(encryption_algorithm, key)
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
    let metadata=JSON.parse(fs.readFileSync(`${__dirname}/uploads/${uuid}.meta.json`));
    if(metadata.is_private){
        if(!req.auth || req.auth.username!==metadata.owner)
            return res.end("Error: Unauthorized");
    }
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
app.post("/auth",function(req,res){
    let postdata={}
    
    // using busboy for this is probably an overkill
    // but we're trying to use fewer dependencies
    req.busboy.on('field', function(formkey, formvalue, keyTruncated, valueTruncated) {
        postdata[formkey]=formvalue
    });
    req.busboy.on('finish', function() {
        let {username,password}=postdata;
        db.findOne({username},function(err,doc){
            if(err)
                return res.end(err);
            if(!doc)
                return res.end("No such user");
            if(password===doc.password){
                let time=60*60*1000;
                let token = jwt.sign({ username: username }, jwt_secretkey,{expiresIn:time});
                res.cookie('jwt', token, { maxAge: time, httpOnly: true });
                return res.redirect("/");
            } else {
                return res.end("Wrong password");
            }
        })
    })
})
app.post("/logout",function(req,res){
    console.log("logging out");
    res.clearCookie('jwt');
    return res.redirect("/");
})

//start app
app.listen(port, () => {
    console.log(`App listening at http://localhost:${port}`)
})