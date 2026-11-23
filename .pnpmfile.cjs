module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.name === 'usocket' && pkg.version === '0.3.0') {
        // This optional D-Bus addon requires Unix headers.
        pkg.os = ['!win32']
      }
      return pkg
    }
  }
}
