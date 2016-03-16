#!/usr/bin/env node


(() => {

/*   Here's your FreshBooks API token & URL
     Replace these   */
var Ftoken = '6267b55910091a10389c330e4164276d';
var FapiPath = 'testcompany9905.freshbooks.com/api/2.1/xml-in';


/* Here's your ZipBooks new account email
   Replace this  */

var signup = true;
var ZUserName = () => { return (signup) ? 'dahart+zipbooks+'+Date.now()+'@limnu.com' : 'dahart+zipbooks@limnu.com'; };
var ZPassword = 'zipbooks';

/*----------------------------------------------------------------------*/
/*----------------------------------------------------------------------*/
/*----------------------------------------------------------------------*/

var Furl = () => {
  return 'https://' + Ftoken + ':X@' + FapiPath.replace(/^https?:\/\//, '');
}

var xml2js  = require('xml2js');
var request = require('request'); // request.debug = true;
var fs      = require('fs');

var Ztoken;
var ZapiPath = 'api.zipbooks.com/v1';
var Zurl = method => 'https://' + ZapiPath + '/' + method + '?token=' + Ztoken;

// https://api.zipbooks.com/v1/time_entries?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOjI4MCwiaXNzIjoiaHR0cHM6XC9cL2FwaS56aXBib29rcy5jb21cL3YxXC9hdXRoXC9sb2dpbiIsImlhdCI6MTQ1NDU0MjQ3OCwiZXhwIjoxNDcwMDkwODc4LCJuYmYiOjE0NTQ1NDI0NzgsImp0aSI6IjVhOTQ3MDU2NTNmOWU1NmYyMWQxMDk5NWIzODQ4MGNiIn0.9gr6QknAkyKkfSOe_Z23BcewfK2Au_XDkRx-uf4d9fQ

var categoryF = [ 'client', 'invoice', 'expense', 'estimate', 'payment', 'project', 'task', 'time_entry', 'category', 'staff' ];
var categoriesF = {}; // Plural
categoryF.forEach((cat) => { categoriesF[cat] = cat+'s'; });
categoriesF['time_entry'] = 'time_entries' ;
categoriesF['category'  ] = 'categories';
categoriesF['staff'     ] = 'staff_members';

// the list singular term for a freshbooks category, indexed by category
// only here because of 'staff' which has a list singular of 'member'
var listCatF = {};
categoryF.forEach((cat) => { listCatF[cat] = cat; });
listCatF['staff'] = 'member';

// zipbooks category names, indexed by freshbooks category
var categoryF2Z   = {};
categoryF.forEach((cat) => { categoryF2Z[cat] = cat; });
categoryF2Z['client'] = 'customer' ;
categoryF2Z['staff' ] = 'user'     ;

// The zipbooks Plural. indexed by f-category
var categoriesF2Z = {};
categoryF.forEach((cat) => { categoriesF2Z[cat] = categoryF2Z[cat]+'s'; });
categoriesF2Z['time_entry'] = 'time_entries' ;
categoriesF2Z['category'  ] = 'ERROR'        ; // this one isn't for upload; make it look wrong

var fdata     = {}; // indexed by f-category
var fids2zids = {}; // id mappings for each category, i.e. fclients<->zclients, indexed by f-category
var zdata     = {}; // indexed by z-category

var translateF2Z = {}; // indexed by f-category

//----------------------------------------------------------------------
// UTILS
//----------------------------------------------------------------------

var dateToISOLocale = (date) => {
  var local = new Date(date);
  local.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return local.toJSON().slice(0, 10);
}

var today = dateToISOLocale(new Date());

var dateRE = /\d{4}-\d\d-\d\d/;

var dayFromDateStrOrToday = (dateStr) => {
  var dateMatch = dateRE.exec(dateStr);
  return (dateMatch) ? dateMatch[0] : today;
}

var j2s = (json) => { return JSON.stringify(json, null, 2); }
var writeFile = (filename, data) => {
  fs.writeFileSync(filename, j2s(data));
  console.log('wrote cache file ' + filename);
  return data;
}

var toDollarsCents = (amt) => { return (Math.round(parseFloat(amt) * 100) / 100).toFixed(2); }

/**----------------------------------------------------------------------
Execute a sequence of promises,
With a max limit on the number of promises in flight at once
'data' is an array containing the data needed to make each promise
  each element of 'data' is passed to 'mkPromiseFn'
'mkPromiseFn' is a function that generates a promise
  called once per item in 'data', passed the single datum, takes only that 1 param
'optQueueSize' is an OPTIONAL number specifying the max queue length
  negative optQueueSize == #data/n, e.g. -1 for no limit, -2 for n/2, etc...
  default optQueueSize == sqrt(data.length)
'optProgressFn' is an OPTIONAL callback that is called for every chunk
and passed the number of completed items

Returns a promise that resolves when all promises in the queue resolve,
or rejects when the first promise in the queue rejects,
just like Promise.all()

Resolves with an array of the results, in the same order as 'data'
Rejects with the first error that occurs

@param {function(...)} mkPromiseFn
@param {Array} data
@param {number=} optQueueSize
@param {function(...)=} optProgressFn
*/
var makePromiseQueue = (mkPromiseFn, data, optQueueSize, optProgressFn) => {
  return new Promise((resolve, reject) => {
    var n = data.length;
    optQueueSize = optQueueSize || Math.round(Math.sqrt(n));
    if (optQueueSize < 0) optQueueSize = n / Math.abs(optQueueSize);
    optQueueSize = Math.max(1, Math.min(n, optQueueSize));

    var dataResults = [];
    var nextDataToProcess = 0;
    var totalFinished = 0;

    var start = (idx) => {
      nextDataToProcess++;
      mkPromiseFn(data[idx])
      .then((results) => {
        totalFinished++;
        dataResults[idx] = results;
        if (totalFinished >= n) resolve(dataResults);
        else optProgressFn && optProgressFn(totalFinished, n);
        if (nextDataToProcess < n) start(nextDataToProcess);
       })
      .catch((err) => { reject(err) });
    };

    for (var i = 0; i < optQueueSize; i++) start(i);
  });
};


//----------------------------------------------------------------------
// login to zipbooks, retrieve auth token
var loginZProm = (signup, email, password) => {
  return new Promise((resolve, reject) => {
    var options = {
      uri    : Zurl('auth/' + ((signup) ? 'signup' : 'login')),
      method : 'POST',
      json   : { email: email, password: password }
    }
    console.log('options', options);
    var req = request(options, (err, resp, body) => {
      if (!!err || resp.statusCode !== 200) {
        reject(err || resp.statusCode);
        return;
      }
      console.log('\nAuth:', body.token, '\n');
      resolve(body);
    });
  });
};


//----------------------------------------------------------------------
var xml2jsProm = (xml, filename) => {
  return new Promise((resolve, reject) => {
    xml2js.parseString(xml, {'explicitArray':false}, (err, js) => {
      if (!!err || (js.response.$.status !== 'ok')) {
        console.log('xml2jsProm: error');
        reject(err);
        return;
      }
      writeFile(filename, js);
      resolve(js);
    });
  });
};


//----------------------------------------------------------------------
// request list data from FreshBooks
// cache the result so we're not reading it every time
// ... and used the cached result, if it exists
var getFListProm = (fcategory) => {
  var requestPage = (requestedPage, jsonSoFar) => {
    requestedPage = requestedPage || 1;
    var requestMethod = fcategory+'.list';
    var cacheFileNameNoExt = 'f'+categoriesF[fcategory] + '.' + requestedPage;
    var readXMLProm;
    var xmlFilename = cacheFileNameNoExt + '.xml';
    if (fs.existsSync(xmlFilename)) {
      console.log('reading cached ' + requestMethod + ' from file ' + xmlFilename);
      var clientXML = fs.readFileSync(xmlFilename);
      readXMLProm = Promise.resolve(clientXML);
    } else {
      readXMLProm = new Promise((resolve, reject) => {
        console.log('requesting ' + requestMethod + ' from freshbooks, page ' + requestedPage);
        var requestBody = '<?xml version="1.0" encoding="utf-8"?><request method="'
          + requestMethod
          + '"><per_page>100</per_page><page>'+requestedPage+'</page></request>';
        var url = Furl();
        console.log(url);
        var req = request.post(url, {body:requestBody}, (error, response, body) => {
          if (!error && response.statusCode == 200) {
            // careful, this is not identical to writefile()
            fs.writeFileSync(xmlFilename, body);
            resolve(body);
          } else {
            reject(error || response.statusCode);
          }
        });
      });
    }

    // parse xml, convert to json, also write json to file
    return readXMLProm
    .then((xml) => { return xml2jsProm(xml, cacheFileNameNoExt+'.json') })
    .then((json) => {

      // this is to handle freshbooks' list pagination
      // https://www.freshbooks.com/developers/pagination

      return new Promise(function(resolve, reject) {
        var catPlural = categoriesF[fcategory];
        var response$ = json.response[catPlural].$;
        var page     = parseInt(response$.page    );
        var per_page = parseInt(response$.per_page);
        var pages    = parseInt(response$.pages   );
        var total    = parseInt(response$.total   );

        var listSingular = listCatF[fcategory];
        var array = json.response[catPlural][listSingular];

        if (pages < 1 || (page === 1 && pages === 1)) {
          resolve(json);
        } else {

          // var jsonToPassOn = jsonSoFar;
          if (page === 1) {
            jsonSoFar = json;
          } else {
            // inject json into jsonSoFar
            var arraySoFar = jsonSoFar.response[catPlural][listSingular];
            jsonSoFar.response[catPlural][listSingular] =
              arraySoFar.concat(array);
          }

          if (page === pages) {
            // if we have all the pages, we're done
            resolve(jsonSoFar);
          } else {
            // if we don't have all the pages yet, request the next page
            requestPage(requestedPage+1, jsonSoFar)
            .then( (jsonSoFar) => {
              resolve(jsonSoFar);
            })
            .catch((err) => {reject(err);});
          }
        }
      });
    });
  };

  return requestPage(1, {});
};


//----------------------------------------------------------------------
var mkParseFList = (fcategory) => {
  return (json) => {
    var catPlural = categoriesF[fcategory];
    var numItemsInResponse = parseInt(json.response[catPlural].$.total);
    if (numItemsInResponse < 0) {
      console.log('mkParseFList('+fcategory+'): empty file');
      return;
    }
    var listSingular = listCatF[fcategory];
    var array = json.response[catPlural][listSingular];
    if (!array) return {};
    if (!('length' in array)) { array = [ array ]; }
    if (array.length === 0) return {};
    var dict = {};
    console.log('got ' + array.length + ' ' + catPlural);
    for (var i = 0; i < array.length; i++) {
      dict[array[i][fcategory+'_id']] = array[i];
    }
    fdata[fcategory] = dict;
    return dict;
  };
};


//----------------------------------------------------------------------
// write one datum to ZipBooks
// resolves with the new data id
var mkPutZDatumProm = (zurl) => {
  return (dataZ) => {
    return new Promise((resolve, reject) => {
      // var zNewExpenseURL = Zurl('expenses');
      // console.log('put url ' + zurl);
      // console.log('putting ' + JSON.stringify(dataZ));
      var options = {
        uri    : zurl,
        method : 'POST',
        json   : dataZ
      }
      var req = request(options, (err, resp, body) => {
        if (!!err || resp.statusCode !== 200) {
          console.log('put error:'+JSON.stringify(err || resp.statusCode));
          console.log('put options:'+JSON.stringify(options));
          console.log('response body:',JSON.stringify(body));
          reject(err || resp.statusCode);
        } else {
          // console.log('put response:', JSON.stringify(body));
          resolve(body);
        }
      });
    });
  };
};


//----------------------------------------------------------------------
var mkPutZListProm = (fcategory) => {
  return (fdict) => {
    var zcategory = categoryF2Z[fcategory];

    // console.log('writing '+categoriesF2Z[fcategory]+' to zipbooks');

    var fids = Object.keys(fdict);
    var putZDatumProm = mkPutZDatumProm(Zurl(categoriesF2Z[fcategory]));

    zdata[zcategory] = {};
    fids2zids[fcategory] = {};

    if (fids.length === 0) return Promise.resolve(null);

    return makePromiseQueue((fid) => {
      var datumF = fdict[fid];
      var datumZ = translateF2Z[zcategory](datumF);
      if (!datumZ) {
        console.log('skipped bad ' + fcategory + ' (' + fid + ')');
        return Promise.resolve();
      }
      return Promise.resolve(datumZ)
        .then(() => { return putZDatumProm(datumZ); })
        .then(function(responseZ) {
          var zid = responseZ.id;
          zdata[zcategory][zid] = datumZ;
          fids2zids[fcategory][fid] = zid;
        });
    }, fids);
  };
};


//----------------------------------------------------------------------
// CUSTOMERS / CLIENTS
//----------------------------------------------------------------------

translateF2Z.customer = (customerF) => {
  var customerZ = {};

  // customerZ.name      = customerF.first_name + ' ' + customerF.last_name;
  customerZ.name = customerF.organization;
  customerZ.email     = customerF.email;

  var customerFPhone = customerF.work_phone || customerF.home_phone || customerF.mobile;
  if (customerFPhone) customerZ.phone = customerFPhone;

  if (customerF.p_street1) customerZ.address_1 = customerF.p_street1 ;
  if (customerF.p_street2) customerZ.address_2 = customerF.p_street2 ;
  if (customerF.p_city   ) customerZ.city      = customerF.p_city    ;
  if (customerF.p_state  ) customerZ.state     = customerF.p_state   ;
  if (customerF.p_country) customerZ.country   = customerF.p_country ;
  if (customerF.p_code   ) customerZ.code      = customerF.p_code    ;

  return customerZ;
};


//----------------------------------------------------------------------
// INVOICES
//----------------------------------------------------------------------

translateF2Z.invoice = (invoiceF) => {
  var invoiceZ = {};

  var clientFID = invoiceF.client_id;
  var customerZID = fids2zids.client[clientFID];
  if (!customerZID) {
    // console.log(fids2zids);
    // console.log(fids2zids.client);
    // console.log(clientFID);
    // console.log('invoiceF', JSON.stringify(invoiceF));
    console.log('unresolved customer id');
    customerZID = '0';
    return null;
  }

  invoiceZ.customer = customerZID;
  invoiceZ.number   = invoiceF.number;
  invoiceZ.date     = dayFromDateStrOrToday(invoiceF.date);

  if (invoiceF.discount) invoiceZ.discount = invoiceF.discount + '%';
  if (invoiceF.terms   ) invoiceZ.terms    = invoiceF.terms         ;
  if (invoiceF.notes   ) invoiceZ.notes    = invoiceF.notes         ;

  if (invoiceF.lines && invoiceF.lines.line) {
    var linesF = invoiceF.lines.line;

    if( Object.prototype.toString.call(linesF) !== '[object Array]' ) {
      linesF = [ linesF ];
      // var keys = Object.keys(linesF);
      // console.log(keys.length);
      // if (keys.length !== 1) {
      //   console.log( 'Line items for Z-invoice ' + invoiceF.client_id + ' expecting Array!' );
      //   console.log('got:'+JSON.stringify(linesF));
      // } else {
      //   var key = keys[0];
      //   var data = linesF.key;
      //   linesF = [ data ];
      // }
    }
    invoiceZ.lineItems = [];

    for (var l=0; l < linesF.length; l++) {
      var lineF = linesF[l];
      var lineZ = {};

      var isTimeEntry = (lineF.type==='Time');
      lineZ.type     = isTimeEntry ? 'time_entry' : 'item';
      lineZ.name     = lineF.name        || '';
      lineZ.notes    = lineF.description || '';
      lineZ.rate     = lineF.unit_cost;
      lineZ.quantity = lineF.quantity;

      invoiceZ.lineItems.push(lineZ);
    }
  }

  return invoiceZ;
};


//----------------------------------------------------------------------
// "CATEGORIES" - so unfortunate I chose to override this word!
//----------------------------------------------------------------------

translateF2Z.category = (categoryF) => {
  var categoryZ = {};
  categoryZ.category_id = categoryF.category_id;
  categoryZ.parent_id   = categoryF.parent_id  ;
  categoryZ.name        = categoryF.name       ;
};


//----------------------------------------------------------------------
// EXPENSES
//----------------------------------------------------------------------

translateF2Z.expense = (expenseF) => {
  var expenseZ = {};

  expenseZ.amount = toDollarsCents(expenseF.amount);
  expenseZ.date = dayFromDateStrOrToday(expenseF.date);

  var clientFID = expenseF.client_id;
  if (clientFID !== '0') {
    var customerZID =  fids2zids.client[clientFID];
    if (!customerZID) {
      console.log('unresolved customer id');
      return null;
    }
    expenseZ.customer_id = customerZID;
  }

  // TODO ????
  if (expenseF.vendor) expenseZ.name = expenseF.vendor;

  if (expenseF.category_id) {
    // console.log(fdata.category);
    // console.log(expenseF.category_id);
    // console.log(fdata.category[expenseF.category_id]);
    var category = fdata.category[expenseF.category_id].name;
    expenseZ.category = category ;
  }
  if (expenseF.notes ) expenseZ.note     = expenseF.notes       ;

  return expenseZ;
};


//----------------------------------------------------------------------
// ESTIMATES
//----------------------------------------------------------------------

translateF2Z.estimate = (estimateF) => {
  var estimateZ = {};

  var clientFID = estimateF.client_id;
  var customerZID =  fids2zids.client[clientFID];
  if (!customerZID) {
    console.log('unresolved customer id');
    return null;
  }

  estimateZ.customer = customerZID;
  estimateZ.number   = estimateF.number;
  estimateZ.date     = dayFromDateStrOrToday(estimateF.date);

  if (estimateF.discount) estimateZ.discount = estimateF.discount + '%';
  if (estimateF.terms   ) estimateZ.terms    = estimateF.terms         ;
  if (estimateF.notes   ) estimateZ.notes    = estimateF.notes         ;

  if (estimateF.lines && estimateF.lines.line) {
    var linesF = estimateF.lines.line;

    if( Object.prototype.toString.call(linesF) !== '[object Array]' ) {
      // console.log( 'Line items for Z-estimate ' + estimateF.client_id + ' expecting Array!' );
      linesF = [ linesF ];
    }
    estimateZ.lineItems = [];

    for (var l=0; l < linesF.length; l++) {
      var lineF = linesF[l];
      var lineZ = {};

      var isTimeEntry = (lineF.type==='Time');
      lineZ.type     = isTimeEntry ? 'time_entry' : 'item';
      lineZ.name     = lineF.name        || '';
      lineZ.notes    = lineF.description || '';
      lineZ.rate     = toDollarsCents(lineF.unit_cost);
      lineZ.quantity = lineF.quantity;

      estimateZ.lineItems.push(lineZ);
    }
  }
  return estimateZ;
};


//----------------------------------------------------------------------
// PAYMENTS
//----------------------------------------------------------------------

// TODO: needs a customer??
translateF2Z.payment = (paymentF) => {
  var paymentZ = {};

  var invoiceZID = fids2zids.invoice[paymentF.invoice_id];
  if (!invoiceZID) {
    console.log('unresolved invoice id');
    return null;
  }
  paymentZ.invoice_id = invoiceZID;
  paymentZ.amount     = toDollarsCents(paymentF.amount);
  paymentZ.date       = dayFromDateStrOrToday(paymentF.date);

  var clientFID = paymentF.client_id;
  if (clientFID !== '0') {
    var customerZID =  fids2zids.client[clientFID];
    if (!customerZID) {
      console.log('unresolved customer id');
      return null;
    }
    paymentZ.customer_id = customerZID;
  }

  if (paymentF.type         ) paymentZ.payment_method = paymentF.type         ;
  if (paymentF.notes        ) paymentZ.notes          = paymentF.notes        ;
  if (paymentF.send_receipt ) paymentZ.send_receipt   = paymentF.send_receipt ;

  // TODO ????
  if (paymentF.gateway_transaction) {
    if (paymentF.gateway_transaction.reference_number ) {
      paymentZ.reference_id = paymentF.gateway_transaction.reference_number ;
    }
  }

  return paymentZ;
};


//----------------------------------------------------------------------
// PROJECTS
//----------------------------------------------------------------------

var fTaskId2fProjId = {};

translateF2Z.project = (projectF) => {
  var projectZ = {};

  var clientFID = projectF.client_id;
  if (clientFID !== '0') {
    var customerZID =  fids2zids.client[clientFID];
    // if (!customerZID) { throw new Error('no customer id. ' + JSON.stringify(projectF)); }
    if (!!customerZID) projectZ.customer_id = customerZID;
  }

  projectZ.name = projectF.name || 'Unnamed project';

  var f2zBillMethod = {
    'task-rate'    : 'task_rate'   ,
    'flat-rate'    : 'flat_amount' ,
    'project-rate' : 'project_rate',
    'staff-rate'   : 'staff_rate'
  }
  projectZ.billing_method = f2zBillMethod[projectF.bill_method] || 'flat_amount';

  switch (projectZ.billing_method) {
    case 'project_rate':
      projectZ.hourly_rate = toDollarsCents(projectF.rate);
      break;
    case 'flat_amount':
      projectZ.flat_amount = toDollarsCents(projectF.flat_amount);
      break;
    default:
      // rate is alread implicit
      break;
  }

  if (projectF.description ) projectZ.description = projectF.description ;

  if (projectF.tasks && projectF.tasks.task) {
    var tasks = projectF.tasks.task;

    if( Object.prototype.toString.call(tasks) !== '[object Array]' ) {
      console.log( 'Tasks for Z-project ' + projectF.client_id + ' expecting Array!' );
    }
    // projectZ.tasks = [];

    // This array is just task ids, not task data
    // record the task-project association so we can record project ids in the tasks later
    for (var i=0; i < tasks.length; i++) {
      var ftask = tasks[i];
      var ftaskId = ftask.task_id;
      if (!fTaskId2fProjId[ftaskId]) {
        fTaskId2fProjId[ftaskId] = [];
      }
      fTaskId2fProjId[ftaskId].push(projectF.project_id);
    }
    // console.log('fTaskId2fProjId',fTaskId2fProjId)
  }

  return projectZ;
};

//----------------------------------------------------------------------
// TASKS
//----------------------------------------------------------------------

translateF2Z.task = (taskF) => {
  taskZ = {};

  // console.log(fTaskId2fProjId);

  // var fprojectId = fTaskId2fProjId[taskF.task_id];
  // console.log('fprojectId',fprojectId);
  // console.log('taskF',taskF);
  // console.log('fids2zids.project',fids2zids.project);
  // taskZ.project_id = fids2zids.project[fprojectId];
  // if (!taskZ.project_id) { throw new Error('no project id'); }
  taskZ.name = taskF.name;

  if (taskF.rate)     taskZ.hourly_rate = taskF.rate;
  if (taskF.billable) taskZ.billable    = (taskF.billable === '1');

  return taskZ;
};


//----------------------------------------------------------------------
var putZTaskListProm = (fdict) => {
  var fcategory = 'task';
  var zcategory = categoryF2Z[fcategory];

  // console.log('writing '+categoriesF2Z[fcategory]+' to zipbooks');

  var fids = Object.keys(fdict);
  var putZDatumProm = mkPutZDatumProm(Zurl(categoriesF2Z[fcategory]));

  zdata[zcategory] = {};
  fids2zids[fcategory] = {};

  return makePromiseQueue((fid) => {
    var datumF = fdict[fid];
    var datumZ = translateF2Z[fcategory](datumF);
    var prom = Promise.resolve(null);
    // var ftaskId = datumF.task_id;
    var ftaskProjectIds = fTaskId2fProjId[fid];
    if (!ftaskProjectIds) {
      console.log('Warning: skipping task ' + fid + ' -- no associated projects');
      return prom;
    }

    fids2zids[fcategory][fid] = {};

    ftaskProjectIds.forEach((ftaskProjectId) => {
      prom = prom.then(() => {
        var zProjTask = JSON.parse(JSON.stringify(datumZ)); // note: copy object, since project_id is changing
        zProjTask.project_id = fids2zids.project[ftaskProjectId];
        if (!zProjTask.project_id) { throw new Error('no project id'); }
        return putZDatumProm(zProjTask)
          .then(function(responseZ) {
            // console.log('wrote task', fid, 'for project', ftaskProjectId);
            var zid = responseZ.id;

            // // debug info
            // zProjTask.ftaskId = fid;
            // zProjTask.fprojId = ftaskProjectId;
            // zProjTask.zid = zid;

            zdata[zcategory][zid] = zProjTask;
            fids2zids[fcategory][fid][ftaskProjectId] = zid;
          });
      });
    });
    return prom;
  }, fids);
};


//----------------------------------------------------------------------
// For each task,
// find the list of associated projects
// upload & duplicate the task once per project

var processTasks = () => {
  fcategory = 'task';
  var zcategory = categoryF2Z[fcategory];
  return getFListProm(fcategory)
  .then(mkParseFList(fcategory))
  .then(putZTaskListProm)
  .then(function() {
    console.log('finished sending',Object.keys(zdata[zcategory]).length,'project-tasks');
    // console.log('fids2zids', categoriesF2Z[fcategory]+':', fids2zids[fcategory]);
    writeFile('z'+categoriesF2Z[fcategory]+'.json', zdata[zcategory]);
    console.log('--------------------');
  });
};

//----------------------------------------------------------------------
// TIME ENTRIES
//----------------------------------------------------------------------

translateF2Z.time_entry = (time_entryF) => {
  time_entryZ = {};

  // fids2zids[fcategory][fid][ftaskProjectId] = zid;

  if (!time_entryF.task_id) {
    console.log('no ftask id');
    return null;
  }
  if (!time_entryF.project_id) {
    console.log('no fproject id');
    return null;
  }

  try {
    time_entryZ.task_id = fids2zids.task[time_entryF.task_id][time_entryF.project_id];
  } catch(e) {
    console.log('unresolved task');
    return null;
  }

  if (!time_entryZ.task_id) {
    console.log('no ztask id');
    return null;
  }

  time_entryZ.duration = (time_entryF.hours || 0) * 3600;

  if (time_entryF.date)  time_entryZ.date = dayFromDateStrOrToday(time_entryF.date);
  if (time_entryF.notes) time_entryZ.node = time_entryF.notes;

  return time_entryZ;
};


//----------------------------------------------------------------------
// USERS / STAFF
//----------------------------------------------------------------------

translateF2Z.user = (userF) => {
  userZ = {};

  if (!userF.email) {
    console.log('no fuser email');
    return null;
  }

  userZ.email = userF.email;
  // For debugging, use fake emails
  // userZ.email = userF.email.replace('@', '+'+Date.now()+'@');
  userZ.password = 'password';
  userZ.permissions = [2,4,5,6,7,8,9,10,11];

  if (userF.first_name) userZ.first_name  = userF.first_name;
  if (userF.last_name ) userZ.last_name   = userF.last_name ;
  if (userF.rate      ) userZ.hourly_rate = userF.rate      ;

  return userZ;
};


//----------------------------------------------------------------------
// main
//----------------------------------------------------------------------

// Promise.resolve(0).then()

var processCategory = (fcategory, optSkipPutZ) => () => {

  if (categoryF.indexOf(fcategory) < 0) throw new Error('invalid F category in processCategory()');
  var zcategory = categoryF2Z[fcategory];
  return getFListProm(fcategory)
  .then(mkParseFList(fcategory))
  .then((json)=>{
    if (!optSkipPutZ) {
      return mkPutZListProm(fcategory)(json)
      .then(() => {
        console.log('finished sending',Object.keys(zdata[zcategory]).length,categoriesF2Z[fcategory]);
        // console.log(categoriesF2Z[fcategory]+':', fids2zids[fcategory]);
        writeFile('z'+categoriesF2Z[fcategory]+'.json', zdata[zcategory]);
        console.log('--------------------');
      });
    }
  })
  .catch((err) => {
    console.log((!!err) ? err.stack || JSON.stringify(err) : 'what?');
    return Promise.reject(err);
  });
};


var fresh2zip = (optUsername, optPassword, optFreshToken, optFreshSubdomain) => {
  var userName = optUsername || ZUserName();
  var password = optPassword || ZPassword;

  Ftoken   = optFreshToken || Ftoken;
  FapiPath = optFreshSubdomain || FapiPath;

  Promise.resolve(null)

  // login
  .then(() => { return loginZProm(signup, userName, password) })
  .then((resp) => { console.log('email', userName, 'password', password); return resp; })
  .then((resp) => { Ztoken = resp.token; })

  .then(processCategory('client'))
  .then(processCategory('invoice'))

  .then(processCategory('category', true))
  .then(() => {
    // ANNOYING! freshbooks stores category with zero-padded ids, then references them without zeroes
    for (var strId in fdata.category) {
      fdata.category[parseInt(strId,10)] = fdata.category[strId];
    }
  })

  .then(processCategory('expense'))
  .then(processCategory('estimate'))
  .then(processCategory('payment'))
  .then(processCategory('project'))
  .then(processTasks)
  // .then(_=>{ console.log('fids2zids tasks', fids2zids.task); })

  .then(processCategory('time_entry'))
  .then(processCategory('staff'))

  .then(() => { writeFile('zdata.json', zdata); })
  .then(() => { writeFile('fids2zids.json', fids2zids); })
  .then(() => { console.log('\ndone', userName, password); })
  .catch((err) => console.log('last catch error:', err, err.stack||''))
  ;
}

if (!module.parent) {
  fresh2zip();
} else {
  exports.fresh2zip = fresh2zip;
}
})();
