/*
FlowRouter.route('/',{
  name: 'main',
  action(){
    BlazeLayout.render('main', {main: 'home'})
  }
})
*/

Router.route('/', function(){
  var _id = Meteor.userId();
  var timelineIds = Friendship.timelineIds(_id);
  this.render('home', {
    data: function(){
      return{
        posts: Post.list(timelineIds),
        followers: Friendship.followers(_id),
        followings: Friendship.followings(_id)

      }
    }
  });
}, {
  name: 'home', 
  fastRender: true
})


