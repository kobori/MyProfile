var require = meteorInstall({"models":{"data_base.js":function(){

///////////////////////////////////////////////////////////////////////
//                                                                   //
// models/data_base.js                                               //
//                                                                   //
///////////////////////////////////////////////////////////////////////
                                                                     //
Post = new Mongo.Collection('posts');

Post.publish = function (message, name) {
  var params = {
    message: message,
    name: name,
    time: new Date(),
    userId: Meteor.userId()
  };
  this.insert(params);
  winston.info("Post.publish: ", params);
};

Post.list = function (userIds) {
  return this.find({
    userId: {
      "$in": userIds
    }
  }, {
    sort: {
      time: -1,
      name: 1
    }
  });
};
///////////////////////////////////////////////////////////////////////

},"friendship.js":function(){

///////////////////////////////////////////////////////////////////////
//                                                                   //
// models/friendship.js                                              //
//                                                                   //
///////////////////////////////////////////////////////////////////////
                                                                     //
Friendship = new Meteor.Collection('friendships');

Friendship.follow = function (friendId) {
  var params = {
    userId: Meteor.userId(),
    friendId: friendId
  };
  this.insert(params);
  winston.info("Friendship.follow: ", params);
};

Friendship.unfollow = function (friendId) {
  var params = {
    userId: Meteor.userId(),
    friendId: friendId
  };
  this.remove(params);
  winston.info("Friendship.unfollow: ", params);
};

Friendship.isFollowing = function (friendId) {
  return this.findOneFaster({
    userId: Meteor.userId(),
    friendId: friendId
  });
};

Friendship.followings = function (userId) {
  return this.find({
    userId: userId
  }).count();
};

Friendship.followers = function (friendId) {
  return this.find({
    friendId: friendId
  }).count();
};

Friendship.timelineIds = function (userId) {
  var timelineIds = this.find({
    userId: userId
  }).map(function (f) {
    return f.friendId;
  });
  timelineIds.push(userId);
  return timelineIds;
};

Friendship.followersAndFollowings = function (_id) {
  return this.find({
    $or: [{
      userId: _id
    }, {
      friendId: _id
    }]
  });
};
///////////////////////////////////////////////////////////////////////

}},"routes":{"friendship.js":function(){

///////////////////////////////////////////////////////////////////////
//                                                                   //
// routes/friendship.js                                              //
//                                                                   //
///////////////////////////////////////////////////////////////////////
                                                                     //
Router.route("/user/:_id/follow", function () {
  var _id = this.params._id;
  Meteor.call("followUser", _id);
  this.redirect("/user/" + _id);
}, {
  name: "user.follow"
});
Router.route("/user/:_id/unfollow", function () {
  var _id = this.params._id;
  Meteor.call("unfollowUser", _id);
  this.redirect("/user/" + _id);
}, {
  name: "user.unfollow"
});
///////////////////////////////////////////////////////////////////////

},"home.js":function(){

///////////////////////////////////////////////////////////////////////
//                                                                   //
// routes/home.js                                                    //
//                                                                   //
///////////////////////////////////////////////////////////////////////
                                                                     //
/*
FlowRouter.route('/',{
  name: 'main',
  action(){
    BlazeLayout.render('main', {main: 'home'})
  }
})
*/Router.route('/', function () {
  var _id = Meteor.userId();

  var timelineIds = Friendship.timelineIds(_id);
  this.render('home', {
    data: function () {
      return {
        posts: Post.list(timelineIds),
        followers: Friendship.followers(_id),
        followings: Friendship.followings(_id)
      };
    }
  });
}, {
  name: 'home',
  fastRender: true
});
Router.route('/amigos', function () {
  var _id = Meteor.userId();

  this.render('amigos', {
    data: function () {
      return {
        posts: Post.find({})
      };
    }
  });
});
///////////////////////////////////////////////////////////////////////

},"index.js":function(){

///////////////////////////////////////////////////////////////////////
//                                                                   //
// routes/index.js                                                   //
//                                                                   //
///////////////////////////////////////////////////////////////////////
                                                                     //
Router.configure({
  layoutTemplate: "main"
});
///////////////////////////////////////////////////////////////////////

},"user.js":function(){

///////////////////////////////////////////////////////////////////////
//                                                                   //
// routes/user.js                                                    //
//                                                                   //
///////////////////////////////////////////////////////////////////////
                                                                     //
Router.route("/user/:_id", function () {
  var _id = this.params._id;
  this.subscribe("user", _id);
  var isFollowing = Friendship.isFollowing(_id);
  Session.set("currentUserId", _id);
  Session.set("isFollowing", isFollowing);
  this.render("user", {
    data: function () {
      return {
        user: Meteor.users.findOne({
          _id: _id
        }),
        posts: Post.list([_id]),
        followers: Friendship.followers(_id),
        followings: Friendship.followings(_id)
      };
    }
  });
}, {
  name: "user",
  fastRender: true
});
///////////////////////////////////////////////////////////////////////

}},"server":{"accounts.js":function(){

///////////////////////////////////////////////////////////////////////
//                                                                   //
// server/accounts.js                                                //
//                                                                   //
///////////////////////////////////////////////////////////////////////
                                                                     //
Accounts.onCreateUser(function (options, user) {
  user['profile'] = options.profile;
  return user;
});
///////////////////////////////////////////////////////////////////////

},"methods.js":function(){

///////////////////////////////////////////////////////////////////////
//                                                                   //
// server/methods.js                                                 //
//                                                                   //
///////////////////////////////////////////////////////////////////////
                                                                     //
Meteor.methods({
  followUser: function (friendId) {
    Friendship.follow(friendId);
  },
  unfollowUser: function (friendId) {
    Friendship.unfollow(friendId);
  },
  profileUpdate: function (name, about) {
    Meteor.users.update({
      _id: this.userId
    }, {
      $set: {
        "profile.name": name,
        "profile.about": about
      }
    });
    Post.update({
      userId: this.userId
    }, {
      $set: {
        name: name
      }
    }, {
      multi: true
    });
  },
  addPost: function (message, name) {
    Post.publish(message, name);
  },
  removeTimeline: function (id) {
    Post.remove({
      _id: id,
      userId: this.userId
    });
  }
});
///////////////////////////////////////////////////////////////////////

},"publication.js":function(require){

///////////////////////////////////////////////////////////////////////
//                                                                   //
// server/publication.js                                             //
//                                                                   //
///////////////////////////////////////////////////////////////////////
                                                                     //
winston = Meteor.require('winston');
winston.add(winston.transports.File, {
  filename: '../application.log',
  maxsize: 1024
});
Meteor.startup(function () {
  console.log("Iniciando Meteor Bird");
});
///////////////////////////////////////////////////////////////////////

},"startup.js":function(){

///////////////////////////////////////////////////////////////////////
//                                                                   //
// server/startup.js                                                 //
//                                                                   //
///////////////////////////////////////////////////////////////////////
                                                                     //
Meteor.startup(function () {
  Meteor.publish("posts", function (_id) {
    var _id = Meteor.userId();

    var timelineIds = Friendship.timelineIds(_id);
    return Post.list(timelineIds);
  });
  Meteor.publish("friendship", function (_id) {
    var _id = Meteor.userId();

    return Friendship.followersAndFollowings(_id);
  });
  Meteor.publish("isFollowing", function (_id) {
    var _id = Meteor.userId();

    return Friendship.isFollowing(_id);
  });
  Meteor.publish("user", function (_id) {
    return Meteor.users.find({
      _id: _id
    });
  });
});
///////////////////////////////////////////////////////////////////////

}}},{
  "extensions": [
    ".js",
    ".json"
  ]
});
require("./models/data_base.js");
require("./models/friendship.js");
require("./routes/friendship.js");
require("./routes/home.js");
require("./routes/index.js");
require("./routes/user.js");
require("./server/accounts.js");
require("./server/methods.js");
require("./server/publication.js");
require("./server/startup.js");
//# sourceURL=meteor://💻app/app/app.js
//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm1ldGVvcjovL/CfkrthcHAvbW9kZWxzL2RhdGFfYmFzZS5qcyIsIm1ldGVvcjovL/CfkrthcHAvbW9kZWxzL2ZyaWVuZHNoaXAuanMiLCJtZXRlb3I6Ly/wn5K7YXBwL3JvdXRlcy9mcmllbmRzaGlwLmpzIiwibWV0ZW9yOi8v8J+Su2FwcC9yb3V0ZXMvaG9tZS5qcyIsIm1ldGVvcjovL/CfkrthcHAvcm91dGVzL2luZGV4LmpzIiwibWV0ZW9yOi8v8J+Su2FwcC9yb3V0ZXMvdXNlci5qcyIsIm1ldGVvcjovL/CfkrthcHAvc2VydmVyL2FjY291bnRzLmpzIiwibWV0ZW9yOi8v8J+Su2FwcC9zZXJ2ZXIvbWV0aG9kcy5qcyIsIm1ldGVvcjovL/CfkrthcHAvc2VydmVyL3B1YmxpY2F0aW9uLmpzIiwibWV0ZW9yOi8v8J+Su2FwcC9zZXJ2ZXIvc3RhcnR1cC5qcyJdLCJuYW1lcyI6WyJQb3N0IiwiTW9uZ28iLCJDb2xsZWN0aW9uIiwicHVibGlzaCIsIm1lc3NhZ2UiLCJuYW1lIiwicGFyYW1zIiwidGltZSIsIkRhdGUiLCJ1c2VySWQiLCJNZXRlb3IiLCJpbnNlcnQiLCJ3aW5zdG9uIiwiaW5mbyIsImxpc3QiLCJ1c2VySWRzIiwiZmluZCIsInNvcnQiLCJGcmllbmRzaGlwIiwiZm9sbG93IiwiZnJpZW5kSWQiLCJ1bmZvbGxvdyIsInJlbW92ZSIsImlzRm9sbG93aW5nIiwiZmluZE9uZUZhc3RlciIsImZvbGxvd2luZ3MiLCJjb3VudCIsImZvbGxvd2VycyIsInRpbWVsaW5lSWRzIiwibWFwIiwiZiIsInB1c2giLCJmb2xsb3dlcnNBbmRGb2xsb3dpbmdzIiwiX2lkIiwiJG9yIiwiUm91dGVyIiwicm91dGUiLCJjYWxsIiwicmVkaXJlY3QiLCJyZW5kZXIiLCJkYXRhIiwicG9zdHMiLCJmYXN0UmVuZGVyIiwiY29uZmlndXJlIiwibGF5b3V0VGVtcGxhdGUiLCJzdWJzY3JpYmUiLCJTZXNzaW9uIiwic2V0IiwidXNlciIsInVzZXJzIiwiZmluZE9uZSIsIkFjY291bnRzIiwib25DcmVhdGVVc2VyIiwib3B0aW9ucyIsInByb2ZpbGUiLCJtZXRob2RzIiwiZm9sbG93VXNlciIsInVuZm9sbG93VXNlciIsInByb2ZpbGVVcGRhdGUiLCJhYm91dCIsInVwZGF0ZSIsIiRzZXQiLCJtdWx0aSIsImFkZFBvc3QiLCJyZW1vdmVUaW1lbGluZSIsImlkIiwicmVxdWlyZSIsImFkZCIsInRyYW5zcG9ydHMiLCJGaWxlIiwiZmlsZW5hbWUiLCJtYXhzaXplIiwic3RhcnR1cCIsImNvbnNvbGUiLCJsb2ciXSwibWFwcGluZ3MiOiI7Ozs7Ozs7O0FBQUFBLE9BQU8sSUFBSUMsTUFBTUMsVUFBVixDQUFxQixPQUFyQixDQUFQOztBQUVBRixLQUFLRyxPQUFMLEdBQWUsVUFBU0MsT0FBVCxFQUFrQkMsSUFBbEIsRUFBd0I7QUFDdEMsTUFBSUMsU0FBUztBQUNaRixhQUFTQSxPQURHO0FBRVpDLFVBQU1BLElBRk07QUFHWkUsVUFBTSxJQUFJQyxJQUFKLEVBSE07QUFJWkMsWUFBUUMsT0FBT0QsTUFBUDtBQUpJLEdBQWI7QUFNQSxPQUFLRSxNQUFMLENBQVlMLE1BQVo7QUFDQU0sVUFBUUMsSUFBUixDQUFhLGdCQUFiLEVBQStCUCxNQUEvQjtBQUNBLENBVEQ7O0FBWUFOLEtBQUtjLElBQUwsR0FBWSxVQUFTQyxPQUFULEVBQWtCO0FBQzdCLFNBQU8sS0FBS0MsSUFBTCxDQUNOO0FBQUNQLFlBQVE7QUFBQyxhQUFPTTtBQUFSO0FBQVQsR0FETSxFQUVOO0FBQUNFLFVBQU07QUFBQ1YsWUFBTSxDQUFDLENBQVI7QUFBV0YsWUFBTTtBQUFqQjtBQUFQLEdBRk0sQ0FBUDtBQUlBLENBTEQsQzs7Ozs7Ozs7Ozs7QUNkQWEsYUFBYSxJQUFJUixPQUFPUixVQUFYLENBQXNCLGFBQXRCLENBQWI7O0FBRUFnQixXQUFXQyxNQUFYLEdBQW9CLFVBQVNDLFFBQVQsRUFBbUI7QUFDdEMsTUFBSWQsU0FBUztBQUNaRyxZQUFRQyxPQUFPRCxNQUFQLEVBREk7QUFFWlcsY0FBVUE7QUFGRSxH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RUF0RCxRQUFRdUQsR0FBUixDQUFZdkQsUUFBUXdELFVBQVIsQ0FBbUJDLElBQS9CLEVBQXFDO0FBQ25DQyxZQUFVLG9CQUR5QjtBQUVuQ0MsV0FBUztBQUYwQixDQUFyQztBQUtBN0QsT0FBTzhELE9BQVAsQ0FBZSxZQUFXO0FBQ3hCQyxVQUFRQyxHQUFSLENBQVksdUJBQVo7QUFDRCxDQUZELEU7Ozs7Ozs7Ozs7O0FDUEFoRSxPQUFPOEQsT0FBUCxDQUFlLFlBQVc7QUFFeEI5RCxTQUFPUCxPQUFQLENBQWUsT0FBZixFQUF3QixVQUFTOEIsR0FBVCxFQUFjO0FBQ3BDLFFBQUlBLE1BQU12QixPQUFPRCxNQUFQLEVBQVY7O0FBQ0EsUUFBSW1CLGNBQWNWLFdBQVdVLFdBQVgsQ0FBdUJLLEdBQXZCLENBQWxCO0FBQ0EsV0FBT2pDLEtBQUtjLElBQUwsQ0FBVWMsV0FBVixDQUFQO0FBQ0QsR0FKRDtBQU1BbEIsU0FBT1AsT0FBUCxDQUFlLFlBQWYsRUFBNkIsVUFBUzhCLEdBQVQsRUFBYztBQUN6QyxRQUFJQSxNQUFNdkIsT0FBT0QsTUFBUCxFQUFWOztBQUNBLFdBQU9TLFdBQVdjLHNCQUFYLENBQWtDQyxHQUFsQyxDQUFQO0FBQ0QsR0FIRDtBQU1BdkIsU0FBT1AsT0FBUCxDQUFlLGFBQWYsRUFBOEIsVUFBUzhCLEdBQVQsRUFBYztBQUMxQyxRQUFJQSxNQUFNdkIsT0FBT0QsTUFBUCxFQUFWOztBQUNBLFdBQU9TLFdBQVdLLFdBQVgsQ0FBdUJVLEdBQXZCLENBQVA7QUFDRCxHQUhEO0FBTUF2QixTQUFPUCxPQUFQLENBQWUsTUFBZixFQUF1QixVQUFTOEIsR0FBVCxFQUFjO0FBQ25DLFdBQU92QixPQUFPdUMsS0FBUCxDQUFhakMsSUFBYixDQUFrQjtBQUFDaUIsV0FBS0E7QUFBTixLQUFsQixDQUFQO0FBQ0QsR0FGRDtBQUtELENBekJELEUiLCJmaWxlIjoiL2FwcC5qcyIsInNvdXJjZXNDb250ZW50IjpbIlBvc3QgPSBuZXcgTW9uZ28uQ29sbGVjdGlvbigncG9zdHMnKTtcblxuUG9zdC5wdWJsaXNoID0gZnVuY3Rpb24obWVzc2FnZSwgbmFtZSkge1xuIHZhciBwYXJhbXMgPSB7XG4gIG1lc3NhZ2U6IG1lc3NhZ2UsXG4gIG5hbWU6IG5hbWUsXG4gIHRpbWU6IG5ldyBEYXRlKCksXG4gIHVzZXJJZDogTWV0ZW9yLnVzZXJJZCgpXG4gfTtcbiB0aGlzLmluc2VydChwYXJhbXMpO1xuIHdpbnN0b24uaW5mbyhcIlBvc3QucHVibGlzaDogXCIsIHBhcmFtcyk7XG59O1xuXG5cblBvc3QubGlzdCA9IGZ1bmN0aW9uKHVzZXJJZHMpIHtcbiByZXR1cm4gdGhpcy5maW5kKFxuICB7dXNlcklkOiB7XCIkaW5cIjogdXNlcklkc319LFxuICB7c29ydDoge3RpbWU6IC0xLCBuYW1lOiAxfX1cbiApO1xufTsiLCJGcmllbmRzaGlwID0gbmV3IE1ldGVvci5Db2xsZWN0aW9uKCdmcmllbmRzaGlwcycpO1xuXG5GcmllbmRzaGlwLmZvbGxvdyA9IGZ1bmN0aW9uKGZyaWVuZElkKSB7XG4gdmFyIHBhcmFtcyA9IHtcbiAgdXNlcklkOiBNZXRlb3IudXNlcklkKCksXG4gIGZyaWVuZElkOiBmcmllbmRJZFxuIH07XG4gdGhpcy5pbnNlcnQocGFyYW1zKTtcbiB3aW5zdG9uLmluZm8oXCJGcmllbmRzaGlwLmZvbGxvdzogXCIsIHBhcmFtcyk7XG59O1xuXG5GcmllbmRzaGlwLnVuZm9sbG93ID0gZnVuY3Rpb24oZnJpZW5kSWQpIHtcbiB2YXIgcGFyYW1zID0ge1xuICB1c2VySWQ6IE1ldGVvci51c2VySWQoKSxcbiAgZnJpZW5kSWQ6IGZyaWVuZElkXG4gfTtcbiB0aGlzLnJlbW92ZShwYXJhbXMpO1xuIHdpbnN0b24uaW5mbyhcIkZyaWVuZHNoaXAudW5mb2xsb3c6IFwiLCBwYXJhbXMpO1xufTtcblxuRnJpZW5kc2hpcC5pc0ZvbGxvd2luZyA9IGZ1bmN0aW9uKGZyaWVuZElkKSB7XG4gcmV0dXJuIHRoaXMuZmluZE9uZUZhc3Rlcih7XG4gIHVzZXJJZDogTWV0ZW9yLnVzZXJJZCgpLFxuICBmcmllbmRJZDogZnJpZW5kSWRcbiB9KTtcbn07XG5cbkZyaWVuZHNoaXAuZm9sbG93aW5ncyA9IGZ1bmN0aW9uKHVzZXJJZCkge1xuIHJldHVybiB0aGlzLmZpbmQoe3VzZXJJZDogdXNlcklkfSkuY291bnQoKTtcbn07XG5cbkZyaWVuZHNoaXAuZm9sbG93ZXJzID0gZnVuY3Rpb24oZnJpZW5kSWQpIHtcbiByZXR1cm4gdGhpcy5maW5kKHtmcmllbmRJZDogZnJpZW5kSWR9KS5jb3VudCgpO1xufTtcblxuRnJpZW5kc2hpcC50aW1lbGluZUlkcyA9IGZ1bmN0aW9uKHVzZXJJZCkge1xuIHZhciB0aW1lbGluZUlkcyA9IHRoaXMuZmluZCh7XG4gIHVzZXJJZDogdXNlcklkXG4gfSkubWFwKGZ1bmN0aW9uKGYpIHtcbiAgcmV0dXJuIGYuZnJpZW5kSWQ7XG4gfSk7XG4gdGltZWxpbmVJZHMucHVzaCh1c2VySWQpO1xuIHJldHVybiB0aW1lbGluZUlkcztcbn07XG5cbkZyaWVuZHNoaXAuZm9sbG93ZXJzQW5kRm9sbG93aW5ncyA9IGZ1bmN0aW9uKF9pZCkge1xuICByZXR1cm4gdGhpcy5maW5kKHtcbiAgICAkb3I6IFt7dXNlcklkOiBfaWR9LCB7ZnJpZW5kSWQ6IF9pZH1dXG4gIH0pO1xufTtcblxuXG5cblxuXG5cblxuXG5cblxuXG5cblxuXG5cbiIsIlJvdXRlci5yb3V0ZShcIi91c2VyLzpfaWQvZm9sbG93XCIsIGZ1bmN0aW9uKCkge1xuICB2YXIgX2lkID0gdGhpcy5wYXJhbXMuX2lkO1xuICBNZXRlb3IuY2FsbChcImZvbGxvd1VzZXJcIiwgX2lkKTtcbiAgdGhpcy5yZWRpcmVjdChcIi91c2VyL1wiICsgX2lkKTtcbn0sIHsgbmFtZTogXCJ1c2VyLmZvbGxvd1wiIH0pO1xuXG5Sb3V0ZXIucm91dGUoXCIvdXNlci86X2lkL3VuZm9sbG93XCIsIGZ1bmN0aW9uKCkge1xuICB2YXIgX2lkID0gdGhpcy5wYXJhbXMuX2lkO1xuICBNZXRlb3IuY2FsbChcInVuZm9sbG93VXNlclwiLCBfaWQpO1xuICB0aGlzLnJlZGlyZWN0KFwiL3VzZXIvXCIgKyBfaWQpO1xufSwgeyBuYW1lOiBcInVzZXIudW5mb2xsb3dcIiB9KTsiLCIvKlxuRmxvd1JvdXRlci5yb3V0ZSgnLycse1xuICBuYW1lOiAnbWFpbicsXG4gIGFjdGlvbigpe1xuICAgIEJsYXplTGF5b3V0LnJlbmRlcignbWFpbicsIHttYWluOiAnaG9tZSd9KVxuICB9XG59KVxuKi9cblxuUm91dGVyLnJvdXRlKCcvJywgZnVuY3Rpb24oKXtcbiAgdmFyIF9pZCA9IE1ldGVvci51c2VySWQoKTtcbiAgdmFyIHRpbWVsaW5lSWRzID0gRnJpZW5kc2hpcC50aW1lbGluZUlkcyhfaWQpO1xuICB0aGlzLnJlbmRlcignaG9tZScsIHtcbiAgICBkYXRhOiBmdW5jdGlvbigpe1xuICAgICAgcmV0dXJue1xuICAgICAgICBwb3N0czogUG9zdC5saXN0KHRpbWVsaW5lSWRzKSxcbiAgICAgICAgZm9sbG93ZXJzOiBGcmllbmRzaGlwLmZvbGxvd2VycyhfaWQpLFxuICAgICAgICBmb2xsb3dpbmdzOiBGcmllbmRzaGlwLmZvbGxvd2luZ3MoX2lkKVxuXG4gICAgICB9XG4gICAgfVxuICB9KTtcbn0sIHtcbiAgbmFtZTogJ2hvbWUnLCBcbiAgZmFzdFJlbmRlcjogdHJ1ZVxufSlcblxuXG5Sb3V0ZXIucm91dGUoJy9hbWlnb3MnLCBmdW5jdGlvbigpe1xuICB2YXIgX2lkID0gTWV0ZW9yLnVzZXJJZCgpO1xuXG4gIHRoaXMucmVuZGVyKCdhbWlnb3MnLCB7XG5cbiAgICBkYXRhOiBmdW5jdGlvbigpe1xuICAgICAgcmV0dXJue1xuICAgICAgICBwb3N0czogUG9zdC5maW5kKHt9KVxuICAgICAgfVxuICAgIH1cbiAgfSlcbn0pXG4iLCJSb3V0ZXIuY29uZmlndXJlKHtcbiBsYXlvdXRUZW1wbGF0ZTogXCJtYWluXCJcbn0pOyIsIlJvdXRlci5yb3V0ZShcIi91c2VyLzpfaWRcIiwgZnVuY3Rpb24oKSB7XG4gIHZhciBfaWQgPSB0aGlzLnBhcmFtcy5faWQ7ICBcbiAgdGhpcy5zdWJzY3JpYmUoXCJ1c2VyXCIsIF9pZCk7XG4gIHZhciBpc0ZvbGxvd2luZyA9IEZyaWVuZHNoaXAuaXNGb2xsb3dpbmcoX2lkKTtcbiAgU2Vzc2lvbi5zZXQoXCJjdXJyZW50VXNlcklkXCIsIF9pZCk7XG4gIFNlc3Npb24uc2V0KFwiaXNGb2xsb3dpbmdcIiwgaXNGb2xsb3dpbmcpO1xuICB0aGlzLnJlbmRlcihcInVzZXJcIiwge1xuICAgIGRhdGE6IGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgdXNlcjogTWV0ZW9yLnVzZXJzLmZpbmRPbmUoe19pZDogX2lkfSksXG4gICAgICAgIHBvc3RzOiBQb3N0Lmxpc3QoW19pZF0pLFxuICAgICAgICBmb2xsb3dlcnM6IEZyaWVuZHNoaXAuZm9sbG93ZXJzKF9pZCksXG4gICAgICAgIGZvbGxvd2luZ3M6IEZyaWVuZHNoaXAuZm9sbG93aW5ncyhfaWQpXG4gICAgICB9XG4gICAgfVxuICB9KTtcbn0sIHsgXG4gIG5hbWU6IFwidXNlclwiLFxuICBmYXN0UmVuZGVyOiB0cnVlXG59KTtcbiIsIkFjY291bnRzLm9uQ3JlYXRlVXNlcihmdW5jdGlvbihvcHRpb25zLCB1c2VyKSB7XG4gdXNlclsncHJvZmlsZSddID0gb3B0aW9ucy5wcm9maWxlO1xuIHJldHVybiB1c2VyO1xufSk7IiwiTWV0ZW9yLm1ldGhvZHMoe1xuICBmb2xsb3dVc2VyOiBmdW5jdGlvbihmcmllbmRJZCkge1xuICAgIEZyaWVuZHNoaXAuZm9sbG93KGZyaWVuZElkKTtcbiAgIH0sXG5cbiAgdW5mb2xsb3dVc2VyOiBmdW5jdGlvbihmcmllbmRJZCkge1xuICAgIEZyaWVuZHNoaXAudW5mb2xsb3coZnJpZW5kSWQpO1xuICB9LFxuXG4gIHByb2ZpbGVVcGRhdGU6IGZ1bmN0aW9uKG5hbWUsIGFib3V0KSB7XG4gICAgTWV0ZW9yLnVzZXJzLnVwZGF0ZShcbiAgICAgIHtfaWQ6IHRoaXMudXNlcklkfSxcbiAgICAgIHskc2V0OiB7XG4gICAgICAgXCJwcm9maWxlLm5hbWVcIjogbmFtZSxcbiAgICAgICBcInByb2ZpbGUuYWJvdXRcIjogYWJvdXRcbiAgICAgICAgfVxuICAgICAgfVxuICAgICk7XG5cbiAgICBQb3N0LnVwZGF0ZShcbiAgICAgIHt1c2VySWQ6IHRoaXMudXNlcklkfSxcbiAgICAgIHskc2V0OiB7XG4gICAgICAgIG5hbWU6IG5hbWVcbiAgICAgIH19LFxuICAgICAge211bHRpOiB0cnVlfVxuICAgICk7XG4gIH0sXG5cbiAgYWRkUG9zdDogZnVuY3Rpb24obWVzc2FnZSwgbmFtZSl7XG4gICAgUG9zdC5wdWJsaXNoKG1lc3NhZ2UsIG5hbWUpO1xuXG4gIH0sXG4gIFxuICByZW1vdmVUaW1lbGluZTogZnVuY3Rpb24oaWQpe1xuICAgIFBvc3QucmVtb3ZlKHtfaWQ6IGlkLCB1c2VySWQ6IHRoaXMudXNlcklkfSk7XG4gIH1cblxuXG59KSIsIndpbnN0b24gPSBNZXRlb3IucmVxdWlyZSgnd2luc3RvbicpO1xuXG53aW5zdG9uLmFkZCh3aW5zdG9uLnRyYW5zcG9ydHMuRmlsZSwge1xuICBmaWxlbmFtZTogJy4uL2FwcGxpY2F0aW9uLmxvZycsXG4gIG1heHNpemU6IDEwMjRcbn0pO1xuXG5NZXRlb3Iuc3RhcnR1cChmdW5jdGlvbigpIHtcbiAgY29uc29sZS5sb2coXCJJbmljaWFuZG8gTWV0ZW9yIEJpcmRcIik7XG59KTsiLCJNZXRlb3Iuc3RhcnR1cChmdW5jdGlvbigpIHtcblxuICBNZXRlb3IucHVibGlzaChcInBvc3RzXCIsIGZ1bmN0aW9uKF9pZCkgeyBcbiAgICB2YXIgX2lkID0gTWV0ZW9yLnVzZXJJZCgpO1xuICAgIHZhciB0aW1lbGluZUlkcyA9IEZyaWVuZHNoaXAudGltZWxpbmVJZHMoX2lkKTtcbiAgICByZXR1cm4gUG9zdC5saXN0KHRpbWVsaW5lSWRzKTtcbiAgfSk7XG5cbiAgTWV0ZW9yLnB1Ymxpc2goXCJmcmllbmRzaGlwXCIsIGZ1bmN0aW9uKF9pZCkge1xuICAgIHZhciBfaWQgPSBNZXRlb3IudXNlcklkKClcbiAgICByZXR1cm4gRnJpZW5kc2hpcC5mb2xsb3dlcnNBbmRGb2xsb3dpbmdzKF9pZCk7XG4gIH0pO1xuXG4gIFxuICBNZXRlb3IucHVibGlzaChcImlzRm9sbG93aW5nXCIsIGZ1bmN0aW9uKF9pZCkge1xuICAgIHZhciBfaWQgPSBNZXRlb3IudXNlcklkKClcbiAgICByZXR1cm4gRnJpZW5kc2hpcC5pc0ZvbGxvd2luZyhfaWQpO1xuICB9KTtcbiAgXG5cbiAgTWV0ZW9yLnB1Ymxpc2goXCJ1c2VyXCIsIGZ1bmN0aW9uKF9pZCkge1xuICAgIHJldHVybiBNZXRlb3IudXNlcnMuZmluZCh7X2lkOiBfaWR9KTtcbiAgfSk7XG5cblxufSkiXX0=
