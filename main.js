var fresh2zip = require('./fresh2zip.js');

if (false) {
  fresh2zip.fresh2zip();
} else {
  fresh2zip.fresh2zip(
    'dahart+zipbooks+'+Date.now()+'@limnu.com',                     // email
    'zipbooks',                                                     // password
    '09196c23c5cd99e19b156df3f3dd58d8',                             // freshbooks token
    'https://cloudninecommunications.freshbooks.com/api/2.1/xml-in' // freshbooks api subdomain
    );
}
