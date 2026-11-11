// THROWAWAY SPIKE (branch spike/apple-health). Not for release.
//
// Answers the open questions in docs/apple-health-discovery.md on a real
// device:
//   1. Does an iPhone workout session (iOS 26+) stream heart rate from a strap
//      or earbuds paired in iOS Settings, about once a second?
//   2. Does it keep collecting while the phone is locked?
//   3. How late do Apple Watch heart-rate samples reach the phone?
//   4. Does a Watch workout plus a PIVOT session give two workouts in Health?
//   5. iOS 27: live zone updates on iPhone, and zone data on saved workouts,
//      including ones recorded by Apple's Workout app on the Watch.
//
// Everything is appended to an in-memory log (also sent to JS as `onLog`), so
// entries recorded while the phone was locked can be read back afterwards.

import ExpoModulesCore
import HealthKit
import UIKit

private let bpmUnit = HKUnit.count().unitDivided(by: .minute())
private let heartRateType = HKQuantityType(.heartRate)

private func iso(_ date: Date?) -> String? {
  guard let date else { return nil }
  let f = ISO8601DateFormatter()
  f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  return f.string(from: date)
}

/// Thread-safe log shared by the module and its delegates.
final class SpikeLog {
  private let lock = NSLock()
  private var entries: [[String: Any]] = []
  var onEntry: (([String: Any]) -> Void)?

  func add(_ kind: String, _ fields: [String: Any] = [:]) {
    var entry = fields
    entry["kind"] = kind
    entry["at"] = iso(Date())
    lock.lock()
    entries.append(entry)
    lock.unlock()
    onEntry?(entry)
  }

  func all() -> [[String: Any]] {
    lock.lock(); defer { lock.unlock() }
    return entries
  }

  func clear() {
    lock.lock(); entries.removeAll(); lock.unlock()
  }
}

private func describeSample(_ s: HKQuantitySample, receivedAt: Date) -> [String: Any] {
  var out: [String: Any] = [
    "bpm": s.quantity.doubleValue(for: bpmUnit),
    "start": iso(s.startDate) ?? "",
    "end": iso(s.endDate) ?? "",
    "delaySec": receivedAt.timeIntervalSince(s.endDate),
    "source": s.sourceRevision.source.name,
    "bundleId": s.sourceRevision.source.bundleIdentifier,
  ]
  if let product = s.sourceRevision.productType { out["productType"] = product }
  if let device = s.device {
    out["deviceName"] = device.name ?? ""
    out["deviceModel"] = device.model ?? ""
    out["deviceManufacturer"] = device.manufacturer ?? ""
  }
  return out
}

@available(iOS 27.0, *)
private func describeZoneGroup(_ group: HKWorkoutZoneGroup) -> [String: Any] {
  let source: String
  switch group.configuration.source {
  case .system: source = "system"
  case .user: source = "user"
  case .app: source = "app"
  @unknown default: source = "unknown"
  }
  let zones: [[String: Any]] = group.zoneDurations.map { zd in
    var z: [String: Any] = ["index": zd.zone.index, "seconds": zd.duration]
    if let min = zd.zone.minimum { z["min"] = min.doubleValue(for: bpmUnit) }
    if let max = zd.zone.maximum { z["max"] = max.doubleValue(for: bpmUnit) }
    return z
  }
  return ["configSource": source, "zones": zones]
}

@available(iOS 26.0, *)
final class SessionDelegate: NSObject, HKWorkoutSessionDelegate, HKLiveWorkoutBuilderDelegate {
  let log: SpikeLog
  init(log: SpikeLog) { self.log = log }

  func workoutSession(_ workoutSession: HKWorkoutSession,
                      didChangeTo toState: HKWorkoutSessionState,
                      from fromState: HKWorkoutSessionState,
                      date: Date) {
    log.add("session_state", ["from": fromState.rawValue, "to": toState.rawValue, "date": iso(date) ?? ""])
  }

  func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
    let ns = error as NSError
    log.add("session_error", ["message": ns.localizedDescription, "domain": ns.domain, "code": ns.code])
  }

  func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {
    if let event = workoutBuilder.workoutEvents.last {
      log.add("builder_event", ["type": event.type.rawValue, "date": iso(event.dateInterval.start) ?? ""])
    }
  }

  func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>) {
    let now = Date()
    for type in collectedTypes {
      guard let qt = type as? HKQuantityType else { continue }
      guard qt == heartRateType else {
        log.add("builder_other_type", ["type": qt.identifier])
        continue
      }
      guard let stats = workoutBuilder.statistics(for: qt),
            let recent = stats.mostRecentQuantity() else {
        log.add("builder_hr_empty")
        continue
      }
      var fields: [String: Any] = ["bpm": recent.doubleValue(for: bpmUnit)]
      if let interval = stats.mostRecentQuantityDateInterval() {
        fields["sampleEnd"] = iso(interval.end) ?? ""
        fields["delaySec"] = now.timeIntervalSince(interval.end)
      }
      if let avg = stats.averageQuantity() { fields["avg"] = avg.doubleValue(for: bpmUnit) }
      if let max = stats.maximumQuantity() { fields["max"] = max.doubleValue(for: bpmUnit) }
      log.add("live_hr", fields)
    }
  }

  @available(iOS 27.0, *)
  func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didUpdateWorkoutZone zoneUpdate: HKLiveWorkoutZoneUpdate) {
    var fields: [String: Any] = [:]
    if let current = zoneUpdate.currentZoneDuration {
      fields["currentZone"] = current.zone.index
      fields["currentZoneSeconds"] = current.duration
    }
    if let previous = zoneUpdate.previousZoneDuration {
      fields["previousZone"] = previous.zone.index
      fields["previousZoneSeconds"] = previous.duration
    }
    if let processed = zoneUpdate.lastSampleProcessedDate { fields["lastSample"] = iso(processed) ?? "" }
    if let group = zoneUpdate.zoneGroup { fields["group"] = describeZoneGroup(group) }
    log.add("live_zone", fields)
  }
}

public class PivotHealthSpikeModule: Module {
  private let store = HKHealthStore()
  private let log = SpikeLog()
  // Typed as Any: HKWorkoutSession on iPhone needs iOS 26, the app targets 16.4,
  // and stored properties can't be availability-gated.
  private var session: Any?
  private var sessionDelegate: Any?
  private var watchQuery: HKAnchoredObjectQuery?
  private var observers: [NSObjectProtocol] = []

  public func definition() -> ModuleDefinition {
    Name("PivotHealthSpike")

    Events("onLog")

    OnCreate {
      self.log.onEntry = { [weak self] entry in
        self?.sendEvent("onLog", entry)
      }
      // Lock and unlock times, so heart-rate gaps can be lined up with them.
      let center = NotificationCenter.default
      self.observers = [
        center.addObserver(forName: UIApplication.protectedDataWillBecomeUnavailableNotification, object: nil, queue: nil) { [weak self] _ in
          self?.log.add("phone_locking")
        },
        center.addObserver(forName: UIApplication.protectedDataDidBecomeAvailableNotification, object: nil, queue: nil) { [weak self] _ in
          self?.log.add("phone_unlocked")
        },
        center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil) { [weak self] _ in
          self?.log.add("app_background")
        },
        center.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: nil) { [weak self] _ in
          self?.log.add("app_foreground")
        },
      ]
    }

    OnDestroy {
      self.observers.forEach { NotificationCenter.default.removeObserver($0) }
      self.observers = []
    }

    Function("environment") { () -> [String: Any] in
      var supportsSession = false
      var supportsZones = false
      if #available(iOS 26.0, *) { supportsSession = true }
      if #available(iOS 27.0, *) { supportsZones = true }
      return [
        "iosVersion": UIDevice.current.systemVersion,
        "healthDataAvailable": HKHealthStore.isHealthDataAvailable(),
        "supportsIPhoneWorkoutSession": supportsSession,
        "supportsZones": supportsZones,
      ]
    }

    Function("getLog") { () -> [[String: Any]] in
      self.log.all()
    }

    Function("clearLog") {
      self.log.clear()
    }

    Function("note") { (text: String) in
      self.log.add("note", ["text": text])
    }

    // MARK: iPhone workout session (iOS 26+)

    AsyncFunction("startSession") { (activity: String) in
      guard #available(iOS 26.0, *) else {
        self.log.add("session_unsupported", ["ios": UIDevice.current.systemVersion])
        return
      }
      if self.session != nil {
        self.log.add("session_already_running")
        return
      }
      let config = HKWorkoutConfiguration()
      config.activityType = Self.activityType(activity)
      config.locationType = .indoor

      let session = try HKWorkoutSession(healthStore: self.store, configuration: config)
      let builder = session.associatedWorkoutBuilder()
      let source = HKLiveWorkoutDataSource(healthStore: self.store, workoutConfiguration: config)
      source.enableCollection(for: heartRateType, predicate: nil)
      builder.dataSource = source

      let delegate = SessionDelegate(log: self.log)
      session.delegate = delegate
      builder.delegate = delegate
      self.session = session
      self.sessionDelegate = delegate

      let typesToCollect = source.typesToCollect.map { $0.identifier }.sorted()
      self.log.add("session_starting", ["activity": activity, "typesToCollect": typesToCollect])
      session.prepare()
      let start = Date()
      session.startActivity(with: start)
      try await builder.beginCollection(at: start)
      self.log.add("session_collecting")
    }

    AsyncFunction("pauseSession") {
      guard #available(iOS 26.0, *), let session = self.session as? HKWorkoutSession else { return }
      session.pause()
      self.log.add("session_pause_requested")
    }

    AsyncFunction("resumeSession") {
      guard #available(iOS 26.0, *), let session = self.session as? HKWorkoutSession else { return }
      session.resume()
      self.log.add("session_resume_requested")
    }

    AsyncFunction("endSession") { (save: Bool) -> String? in
      guard #available(iOS 26.0, *), let session = self.session as? HKWorkoutSession else {
        self.log.add("session_end_without_session")
        return nil
      }
      let builder = session.associatedWorkoutBuilder()
      session.end()
      defer {
        self.session = nil
        self.sessionDelegate = nil
      }
      try await builder.endCollection(at: Date())
      guard save else {
        builder.discardWorkout()
        self.log.add("session_discarded")
        return nil
      }
      guard let workout = try await builder.finishWorkout() else {
        self.log.add("session_saved_nil")
        return nil
      }
      var fields: [String: Any] = [
        "uuid": workout.uuid.uuidString,
        "durationSec": workout.duration,
      ]
      if let hr = workout.statistics(for: heartRateType) {
        if let avg = hr.averageQuantity() { fields["avgBpm"] = avg.doubleValue(for: bpmUnit) }
        if let max = hr.maximumQuantity() { fields["maxBpm"] = max.doubleValue(for: bpmUnit) }
      }
      if #available(iOS 27.0, *) {
        if let group = workout.zoneGroupsByType?[heartRateType] {
          fields["zones"] = describeZoneGroup(group)
        } else {
          fields["zones"] = "none"
        }
      }
      self.log.add("session_saved", fields)
      return workout.uuid.uuidString
    }

    // MARK: Apple Watch samples as they reach the phone

    Function("startWatchHeartRate") {
      if self.watchQuery != nil { return }
      // Only samples from the last 15 minutes, so the first batch is small.
      let predicate = HKQuery.predicateForSamples(withStart: Date().addingTimeInterval(-15 * 60), end: nil)
      let handle: (HKAnchoredObjectQuery, [HKSample]?, [HKDeletedObject]?, HKQueryAnchor?, Error?, Bool) -> Void = {
        [weak self] _, samples, _, _, error, isUpdate in
        guard let self else { return }
        if let error {
          self.log.add("watch_hr_error", ["message": error.localizedDescription])
          return
        }
        let now = Date()
        for case let s as HKQuantitySample in samples ?? [] {
          var fields = describeSample(s, receivedAt: now)
          fields["initialBatch"] = !isUpdate
          self.log.add("hr_sample", fields)
        }
      }
      let query = HKAnchoredObjectQuery(
        type: heartRateType, predicate: predicate, anchor: nil, limit: HKObjectQueryNoLimit,
        resultsHandler: { q, samples, deleted, anchor, error in handle(q, samples, deleted, anchor, error, false) }
      )
      query.updateHandler = { q, samples, deleted, anchor, error in handle(q, samples, deleted, anchor, error, true) }
      self.store.execute(query)
      self.watchQuery = query
      self.log.add("watch_hr_started")
    }

    Function("stopWatchHeartRate") {
      if let q = self.watchQuery { self.store.stop(q) }
      self.watchQuery = nil
      self.log.add("watch_hr_stopped")
    }

    // MARK: Workouts in Health (double-logging, Watch zones)

    AsyncFunction("recentWorkouts") { (hours: Double, promise: Promise) in
      let predicate = HKQuery.predicateForSamples(withStart: Date().addingTimeInterval(-hours * 3600), end: nil)
      let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)
      let query = HKSampleQuery(sampleType: HKObjectType.workoutType(), predicate: predicate, limit: 20, sortDescriptors: [sort]) {
        [weak self] _, samples, error in
        guard let self else { return }
        if let error {
          self.log.add("workouts_error", ["message": error.localizedDescription])
          promise.resolve([])
          return
        }
        var out: [[String: Any]] = []
        for case let w as HKWorkout in samples ?? [] {
          var fields: [String: Any] = [
            "uuid": w.uuid.uuidString,
            "activityType": w.workoutActivityType.rawValue,
            "start": iso(w.startDate) ?? "",
            "end": iso(w.endDate) ?? "",
            "durationSec": w.duration,
            "source": w.sourceRevision.source.name,
            "bundleId": w.sourceRevision.source.bundleIdentifier,
          ]
          if let product = w.sourceRevision.productType { fields["productType"] = product }
          if let hr = w.statistics(for: heartRateType) {
            if let avg = hr.averageQuantity() { fields["avgBpm"] = avg.doubleValue(for: bpmUnit) }
            if let max = hr.maximumQuantity() { fields["maxBpm"] = max.doubleValue(for: bpmUnit) }
          }
          if #available(iOS 27.0, *) {
            if let group = w.zoneGroupsByType?[heartRateType] {
              fields["zones"] = describeZoneGroup(group)
            } else {
              fields["zones"] = "none"
            }
          }
          out.append(fields)
          self.log.add("workout", fields)
        }
        self.log.add("workouts_listed", ["count": out.count, "hours": hours])
        promise.resolve(out)
      }
      self.store.execute(query)
    }

    // MARK: Preferred zones (iOS 27)

    AsyncFunction("preferredZones") { () -> [String: Any]? in
      guard #available(iOS 27.0, *) else {
        self.log.add("zones_unsupported", ["ios": UIDevice.current.systemVersion])
        return nil
      }
      guard let config = try await self.store.preferredWorkoutZoneConfiguration(for: heartRateType) else {
        self.log.add("preferred_zones", ["result": "nil"])
        return nil
      }
      let source: String
      switch config.source {
      case .system: source = "system"
      case .user: source = "user"
      case .app: source = "app"
      @unknown default: source = "unknown"
      }
      let zones: [[String: Any]] = config.zones.map { zone in
        var z: [String: Any] = ["index": zone.index]
        if let min = zone.minimum { z["min"] = min.doubleValue(for: bpmUnit) }
        if let max = zone.maximum { z["max"] = max.doubleValue(for: bpmUnit) }
        return z
      }
      let result: [String: Any] = ["source": source, "zones": zones]
      self.log.add("preferred_zones", result)
      return result
    }
  }

  private static func activityType(_ name: String) -> HKWorkoutActivityType {
    switch name {
    case "crossTraining": return .crossTraining
    case "hiit": return .highIntensityIntervalTraining
    case "running": return .running
    default: return .functionalStrengthTraining
    }
  }
}
