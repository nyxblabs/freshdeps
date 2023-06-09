/* eslint-disable no-console */
import c from '@nyxb/picocolors'
import consolji from 'consolji'
import type { SingleBar } from 'cli-progress'
import { parseNyxi, parseNyxu, run } from '@nyxb/nyxi'
import { confirm } from '@tyck/prompts'
import { createMultiProgresBar } from '../../log'
import type {
   CheckOptions,
   PackageMeta,
} from '../../types'
import { CheckPackages } from '../../api/check'
import { writePackage } from '../../io/packages'
import { promptInteractive } from './interactive'
import { outputErr, renderPackages } from './render'

export async function check(options: CheckOptions) {
   let exitCode = 0
   const bars = options.loglevel === 'silent' ? null : createMultiProgresBar()
   let packagesBar: SingleBar | undefined
   const depBar = bars?.create(1, 0)

   let resolvePkgs: PackageMeta[] = []

   await CheckPackages(options, {
      afterPackagesLoaded(pkgs) {
         packagesBar = (options.recursive && pkgs.length)
            ? bars?.create(pkgs.length, 0, { type: c.cyan('pkg'), name: c.cyan(pkgs[0].name) })
            : undefined
      },
      beforePackageStart(pkg) {
         packagesBar?.increment(0, { name: c.cyan(pkg.name) })
         depBar?.start(pkg.deps.length, 0, { type: c.green('dep') })
      },
      beforePackageWrite() {
      // disbale auto write
         return false
      },
      afterPackageEnd(pkg) {
         packagesBar?.increment(1)
         depBar?.stop()
         resolvePkgs.push(pkg)
      },
      onDependencyResolved(pkgName, name, progress) {
         depBar?.update(progress, { name })
      },
   })

   bars?.stop()

   if (options.interactive)
      resolvePkgs = await promptInteractive(resolvePkgs, options)

   const { lines, errLines } = renderPackages(resolvePkgs, options)

   const hasChanges = resolvePkgs.length && resolvePkgs.some(i => i.resolved.some(j => j.update))
   if (!hasChanges) {
      if (errLines.length)
         outputErr(errLines)
      else
         console.log(c.green('dependencies are already up-to-date'))

      return exitCode
   }

   consolji.log(lines.join('\n'))

   if (!options.all) {
      const counter = resolvePkgs.reduce((counter, pkg) => {
         for (let i = 0; i < pkg.resolved.length; i++) {
            if (pkg.resolved[i].update)
               return ++counter
         }
         return counter
      }, 0)

      const last = resolvePkgs.length - counter

      if (last === 1)
         consolji.log(c.green('dependencies are already up-to-date in one package\n'))
      else if (last > 0)
         consolji.log(c.green(`dependencies are already up-to-date in ${last} packages\n`))
   }

   if (errLines.length)
      outputErr(errLines)

   if (options.interactive && !options.write) {
      options.write = await confirm({
         message: c.green('write to package.json'),
      }) as boolean
   }

   if (options.write) {
      for (const pkg of resolvePkgs)
         await writePackage(pkg, options)
   }

   // tips
   if (!options.write) {
      console.log()

      if (options.mode === 'default')
         consolji.log(`Run ${c.cyan('freshdeps major')} to check major updates`)

      if (hasChanges) {
         if (options.failOnOutdated)
            exitCode = 1

         consolji.log(`Add ${c.green('-w')} to write to package.json`)
      }

      console.log()
   }
   else if (hasChanges) {
      if (!options.install && !options.update && !options.interactive) {
         consolji.log(
            c.yellow(`ℹ changes written to package.json, run ${c.cyan('npm i')} to install updates.`),
         )
      }

      if (options.install || options.update || options.interactive)
         consolji.log(c.yellow('ℹ changes written to package.json'))

      if (options.interactive && !options.install) {
         options.install = await confirm({
            message: c.green('install now'),
         }) as boolean
      }

      if (options.install) {
         consolji.log(c.magenta('installing...'))
         console.log()

         await run(parseNyxi, [])
      }

      if (options.update) {
         consolji.log(c.magenta('updating...'))
         console.log()

         await run(parseNyxu, options.recursive ? ['-r'] : [])
      }
   }

   return exitCode
}
